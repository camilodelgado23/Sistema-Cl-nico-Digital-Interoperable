"""
routers/admin.py — Panel Admin
CRUD usuarios, audit log filtrable + exportar CSV/JSON, estadísticas.
Solo rol ADMIN.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import asyncpg, csv, io, json, secrets

from core.config import get_db
from core.auth import require_admin, hash_password
from core.audit import log_audit

router = APIRouter(prefix="/admin", tags=["admin"])


# ──────────────────────────────────────────────────────────────────────────────
# USER CRUD
# ──────────────────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    username: str
    password: str
    role: str       # ADMIN | MEDICO | PACIENTE


class UserUpdate(BaseModel):
    is_active: Optional[bool] = None
    role: Optional[str] = None


@router.get("/users")
async def list_users(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        """SELECT id, username, role, is_active, created_at
           FROM users WHERE deleted_at IS NULL
           ORDER BY created_at DESC LIMIT $1 OFFSET $2""",
        limit, offset,
    )
    total = await db.fetchval("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL")
    return {"total": total, "limit": limit, "offset": offset,
            "entry": [dict(r) for r in rows]}


@router.post("/users", status_code=201)
async def create_user(
    body: UserCreate,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    if body.role not in ("ADMIN", "MEDICO", "PACIENTE"):
        raise HTTPException(400, "Rol inválido")
    # Password policy: ≥10 chars, uppercase, digit, symbol
    _validate_password(body.password)

    access_key = secrets.token_hex(16)
    permission_key = secrets.token_hex(16)
    ph = hash_password(body.password[:72])
    
    row = await db.fetchrow(
        """INSERT INTO users (username, password_hash, role, access_key, permission_key)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, username, role, access_key, permission_key, created_at""",
        body.username, ph, body.role, access_key, permission_key,
    )
    await log_audit(db, str(user["id"]), user["role"], "CREATE_USER", "User",
                    str(row["id"]), request.client.host if request.client else None)
    return dict(row)


@router.patch("/users/{uid}")
async def update_user(
    uid: str,
    body: UserUpdate,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    updates, params = [], []
    if body.is_active is not None:
        params.append(body.is_active); updates.append(f"is_active = ${len(params)}")
    if body.role is not None:
        params.append(body.role); updates.append(f"role = ${len(params)}")
    if not updates:
        raise HTTPException(400, "Nada que actualizar")
    params.append(uid)
    await db.execute(
        f"UPDATE users SET {', '.join(updates)} WHERE id = ${len(params)}::uuid",
        *params,
    )
    return {"updated": uid}


@router.delete("/users/{uid}", status_code=204)
async def deactivate_user(
    uid: str,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    await db.execute(
        "UPDATE users SET deleted_at = NOW(), is_active = FALSE WHERE id = $1::uuid", uid
    )
    await log_audit(db, str(user["id"]), user["role"], "DELETE_USER", "User",
                    uid, request.client.host if request.client else None)


@router.post("/users/{uid}/regenerate-keys")
async def regenerate_api_keys(
    uid: str,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    new_access = secrets.token_hex(16)
    new_perm = secrets.token_hex(16)
    await db.execute(
        "UPDATE users SET access_key = $1, permission_key = $2 WHERE id = $3::uuid",
        new_access, new_perm, uid,
    )
    return {"access_key": new_access, "permission_key": new_perm}


# ──────────────────────────────────────────────────────────────────────────────
# AUDIT LOG
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/audit-log")
async def get_audit_log(
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    result: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    filters, params = [], []
    if action:
        params.append(action); filters.append(f"action = ${len(params)}")
    if user_id:
        params.append(user_id); filters.append(f"user_id = ${len(params)}::uuid")
    if result:
        params.append(result); filters.append(f"result = ${len(params)}")
    if date_from:
        params.append(date_from); filters.append(f"ts >= ${len(params)}::timestamptz")
    if date_to:
        params.append(date_to); filters.append(f"ts <= ${len(params)}::timestamptz")

    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    params += [limit, offset]

    rows = await db.fetch(
        f"""SELECT id, ts, user_id, role, action, resource_type, resource_id,
                   ip_address, result, detail
            FROM audit_log {where}
            ORDER BY ts DESC
            LIMIT ${len(params)-1} OFFSET ${len(params)}""",
        *params,
    )
    total = await db.fetchval(f"SELECT COUNT(*) FROM audit_log {where}", *params[:-2])
    return {"total": total, "limit": limit, "offset": offset,
            "entry": [_audit_row(r) for r in rows]}


@router.get("/audit-log/export")
async def export_audit_log(
    fmt: str = Query("json", regex="^(json|csv)$"),
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        """SELECT id, ts, user_id, role, action, resource_type, resource_id,
                  ip_address, result, detail
           FROM audit_log ORDER BY ts DESC LIMIT 10000"""
    )
    data = [_audit_row(r) for r in rows]

    if fmt == "json":
        content = json.dumps(data, default=str, indent=2)
        return StreamingResponse(
            iter([content]),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=audit_log.json"},
        )
    else:
        output = io.StringIO()
        if data:
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=audit_log.csv"},
        )


# ──────────────────────────────────────────────────────────────────────────────
# STATISTICS
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/stats")
async def get_stats(
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    total_inferences = await db.fetchval("SELECT COUNT(*) FROM risk_reports WHERE deleted_at IS NULL")
    accepted = await db.fetchval(
        "SELECT COUNT(*) FROM risk_reports WHERE doctor_action = 'ACCEPTED' AND deleted_at IS NULL"
    )
    rejected = await db.fetchval(
        "SELECT COUNT(*) FROM risk_reports WHERE doctor_action = 'REJECTED' AND deleted_at IS NULL"
    )
    total_patients = await db.fetchval("SELECT COUNT(*) FROM patients WHERE deleted_at IS NULL")
    total_users = await db.fetchval("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL")
    return {
        "total_inferences": total_inferences,
        "accepted": accepted,
        "rejected": rejected,
        "pending_signature": total_inferences - (accepted or 0) - (rejected or 0),
        "acceptance_rate": round(accepted / total_inferences, 4) if total_inferences else 0,
        "total_patients": total_patients,
        "total_users": total_users,
    }


# ── helpers ───────────────────────────────────────────────────────────────────
def _audit_row(row) -> dict:
    return {
        "id": row["id"],
        "ts": row["ts"].isoformat(),
        "user_id": str(row["user_id"]) if row["user_id"] else None,
        "role": row["role"],
        "action": row["action"],
        "resource_type": row["resource_type"],
        "resource_id": str(row["resource_id"]) if row["resource_id"] else None,
        "ip_address": str(row["ip_address"]) if row["ip_address"] else None,
        "result": row["result"],
        "detail": row["detail"],
    }

def _validate_password(password: str):
    import re
    if len(password) < 10:
        raise HTTPException(400, "Contraseña debe tener al menos 10 caracteres")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(400, "Contraseña debe tener al menos una mayúscula")
    if not re.search(r"\d", password):
        raise HTTPException(400, "Contraseña debe tener al menos un número")
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        raise HTTPException(400, "Contraseña debe tener al menos un símbolo")