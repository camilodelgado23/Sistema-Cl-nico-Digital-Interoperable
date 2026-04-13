"""
orchestrator/main.py
Cola de inferencias asíncrona con Semaphore(4).
- POST /infer          → task_id inmediato (no bloquea)
- GET  /infer/{id}     → PENDING | RUNNING | DONE | ERROR
- WS   /ws/infer/{id}  → push en tiempo real al frontend
"""
import asyncio, os, uuid, json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import asyncpg
import httpx
from fastapi import FastAPI, BackgroundTasks, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel

# ── Config ────────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL")
ML_URL       = os.getenv("ML_SERVICE_URL", "http://ml-service:8001")
DL_URL       = os.getenv("DL_SERVICE_URL", "http://dl-service:8002")
MAX_WORKERS  = int(os.getenv("MAX_WORKERS", "4"))
TASK_TIMEOUT = int(os.getenv("TASK_TIMEOUT_SECONDS", "120"))

sem = asyncio.Semaphore(MAX_WORKERS)

# ── DB pool ───────────────────────────────────────────────────────────────────
_pool: asyncpg.Pool | None = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=8)
    return _pool

# ── WebSocket manager ─────────────────────────────────────────────────────────
class WSManager:
    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, task_id: str, ws: WebSocket):
        await ws.accept()
        self._connections.setdefault(task_id, []).append(ws)

    def disconnect(self, task_id: str, ws: WebSocket):
        if task_id in self._connections:
            self._connections[task_id].discard(ws) if hasattr(
                self._connections[task_id], 'discard') else None
            try:
                self._connections[task_id].remove(ws)
            except ValueError:
                pass

    async def broadcast(self, task_id: str, data: dict):
        for ws in list(self._connections.get(task_id, [])):
            try:
                await ws.send_json(data)
            except Exception:
                pass

ws_manager = WSManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield
    if _pool:
        await _pool.close()

app = FastAPI(title="Inference Orchestrator", lifespan=lifespan)


# ── Helpers — BD ──────────────────────────────────────────────────────────────
async def create_queue_entry(patient_id: str, model_type: str, requested_by: str) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO inference_queue (patient_id, model_type, status, requested_by)
               VALUES ($1::uuid, $2, 'PENDING', $3::uuid)
               RETURNING id""",
            patient_id, model_type, requested_by,
        )
    return str(row["id"])


async def set_status(task_id: str, status: str,
                     result_id: Optional[str] = None,
                     error_msg: Optional[str] = None):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE inference_queue
               SET status = $1,
                   completed_at = CASE WHEN $1 IN ('DONE','ERROR') THEN NOW() ELSE completed_at END,
                   result_id = COALESCE($2::uuid, result_id),
                   error_msg = COALESCE($3, error_msg)
               WHERE id = $4::uuid""",
            status, result_id, error_msg, task_id,
        )
    # Push via WebSocket
    await ws_manager.broadcast(task_id, {
        "task_id": task_id, "status": status,
        "result_id": result_id, "error_msg": error_msg,
        "ts": datetime.utcnow().isoformat(),
    })


async def save_risk_report(patient_id: str, model_type: str,
                           requested_by: str, result: dict) -> str:
    pool = await get_pool()
    risk_score    = result.get("risk_score", 0.0)
    risk_category = result.get("risk_category", "LOW")
    is_critical   = result.get("is_critical", False)
    shap_json     = result.get("shap_values") or result.get("gradcam_url")

    async with pool.acquire() as conn:
        # Encrypt prediction using pgcrypto
        aes_key = os.getenv("AES_KEY", "changeme_32_char_key_here______")
        enc_row = await conn.fetchrow(
            "SELECT pgp_sym_encrypt($1, $2) AS enc",
            str(risk_score), aes_key,
        )
        row = await conn.fetchrow(
            """INSERT INTO risk_reports
               (patient_id, model_type, risk_score, risk_category,
                is_critical, prediction_enc, shap_json, signed_by)
               VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, NULL)
               RETURNING id""",
            patient_id, model_type, risk_score, risk_category,
            is_critical,
            enc_row["enc"],
            json.dumps(shap_json) if shap_json else None,
        )
        # Audit log
        await conn.execute(
            """INSERT INTO audit_log (user_id, role, action, resource_type,
                                      resource_id, result)
               VALUES ($1::uuid, 'MEDICO', 'INFERENCE_COMPLETED',
                       'RiskReport', $2::uuid, 'SUCCESS')""",
            requested_by, str(row["id"]),
        )
    return str(row["id"])


# ── Core inference runner ─────────────────────────────────────────────────────
async def run_inference(task_id: str, patient_id: str,
                        model_type: str, requested_by: str):
    async with sem:                          # blocks if 4 already running
        await set_status(task_id, "RUNNING")
        try:
            url = ML_URL if model_type == "ML" else DL_URL
            endpoint = "/ml/predict" if model_type == "ML" else "/dl/predict"

            async with httpx.AsyncClient(timeout=TASK_TIMEOUT) as client:
                r = await client.post(
                    f"{url}{endpoint}",
                    json={"patient_id": patient_id},
                )
                r.raise_for_status()
                result = r.json()

            rid = await save_risk_report(patient_id, model_type, requested_by, result)
            await set_status(task_id, "DONE", result_id=rid)

            # If critical → push alert via WS
            if result.get("is_critical"):
                await ws_manager.broadcast(task_id, {
                    "task_id": task_id,
                    "type": "CRITICAL_ALERT",
                    "patient_id": patient_id,
                    "risk_score": result.get("risk_score"),
                    "risk_category": result.get("risk_category"),
                    "shap_values": result.get("shap_values"),
                    "gradcam_url": result.get("gradcam_url"),
                })

        except asyncio.TimeoutError:
            await set_status(task_id, "ERROR", error_msg="Timeout excedido (120s)")
        except Exception as e:
            await set_status(task_id, "ERROR", error_msg=str(e))


# ── Multimodal (bono) ─────────────────────────────────────────────────────────
async def run_multimodal(task_id: str, patient_id: str, requested_by: str):
    async with sem:
        await set_status(task_id, "RUNNING")
        try:
            async with httpx.AsyncClient(timeout=TASK_TIMEOUT) as client:
                ml_task, dl_task = await asyncio.gather(
                    client.post(f"{ML_URL}/ml/predict", json={"patient_id": patient_id}),
                    client.post(f"{DL_URL}/dl/predict", json={"patient_id": patient_id}),
                )
            ml_result = ml_task.json()
            dl_result = dl_task.json()

            # Late fusion — average probabilities
            combined_score = (
                ml_result.get("risk_score", 0) * 0.5 +
                dl_result.get("risk_score", 0) * 0.5
            )
            fused = {
                "risk_score": round(combined_score, 4),
                "risk_category": _score_to_category(combined_score),
                "is_critical": combined_score >= 0.85,
                "shap_values": ml_result.get("shap_values"),
                "gradcam_url": dl_result.get("gradcam_url"),
            }
            rid = await save_risk_report(patient_id, "MULTIMODAL", requested_by, fused)
            await set_status(task_id, "DONE", result_id=rid)
        except Exception as e:
            await set_status(task_id, "ERROR", error_msg=str(e))


def _score_to_category(score: float) -> str:
    if score < 0.3:  return "LOW"
    if score < 0.6:  return "MEDIUM"
    if score < 0.85: return "HIGH"
    return "CRITICAL"


# ── API endpoints ─────────────────────────────────────────────────────────────
class InferRequest(BaseModel):
    patient_id:   str
    model_type:   str   # ML | DL | MULTIMODAL
    requested_by: str


@app.post("/infer", status_code=202)
async def request_inference(body: InferRequest, bg: BackgroundTasks):
    if body.model_type not in ("ML", "DL", "MULTIMODAL"):
        raise HTTPException(400, "model_type debe ser ML, DL o MULTIMODAL")

    tid = await create_queue_entry(body.patient_id, body.model_type, body.requested_by)

    if body.model_type == "MULTIMODAL":
        bg.add_task(run_multimodal, tid, body.patient_id, body.requested_by)
    else:
        bg.add_task(run_inference, tid, body.patient_id, body.model_type, body.requested_by)

    return {"task_id": tid, "status": "PENDING"}


@app.get("/infer/{task_id}")
async def get_task_status(task_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT id, patient_id, model_type, status,
                      created_at, completed_at, result_id, error_msg
               FROM inference_queue WHERE id = $1::uuid""",
            task_id,
        )
    if not row:
        raise HTTPException(404, "Tarea no encontrada")
    return {
        "task_id":      str(row["id"]),
        "patient_id":   str(row["patient_id"]) if row["patient_id"] else None,
        "model_type":   row["model_type"],
        "status":       row["status"],
        "created_at":   row["created_at"].isoformat(),
        "completed_at": row["completed_at"].isoformat() if row["completed_at"] else None,
        "result_id":    str(row["result_id"]) if row["result_id"] else None,
        "error_msg":    row["error_msg"],
    }


# ── WebSocket endpoint ────────────────────────────────────────────────────────
@app.websocket("/ws/infer/{task_id}")
async def ws_inference_status(websocket: WebSocket, task_id: str):
    """
    Frontend se conecta aquí después de POST /infer.
    Recibe push updates: RUNNING → DONE / ERROR / CRITICAL_ALERT.
    """
    await ws_manager.connect(task_id, websocket)
    try:
        # Send current status immediately on connect
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status, result_id, error_msg FROM inference_queue WHERE id = $1::uuid",
                task_id,
            )
        if row:
            await websocket.send_json({
                "task_id": task_id,
                "status": row["status"],
                "result_id": str(row["result_id"]) if row["result_id"] else None,
                "error_msg": row["error_msg"],
            })
        # Keep alive — wait for disconnect
        while True:
            await asyncio.sleep(30)
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        ws_manager.disconnect(task_id, websocket)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "orchestrator",
            "max_workers": MAX_WORKERS, "semaphore_value": sem._value}