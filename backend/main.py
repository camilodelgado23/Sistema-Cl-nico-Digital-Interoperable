"""
backend/main.py — FastAPI app principal
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
import httpx

from core.config import settings, get_pool, close_pool
from core.auth import require_medico
from routers.auth import router as auth_router
from routers.fhir import router as fhir_router
from routers.admin import router as admin_router

limiter = Limiter(key_func=get_remote_address, default_limits=["500/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: crea pool y aplica migraciones
    pool = await get_pool()
    from core.migrations import MIGRATION_SQL
    async with pool.acquire() as conn:
        await conn.execute(MIGRATION_SQL)
    print("✅ DB pool listo, migraciones aplicadas")
    yield
    await close_pool()
    print("✅ DB pool cerrado")


app = FastAPI(
    title="ClinAI Backend — Proyecto 2",
    version="2.0.0",
    description="FastAPI + FHIR R4 + Doble API-Key + RBAC + AES-256",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(fhir_router)
app.include_router(admin_router)

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["infra"])
async def health():
    return {"status": "ok", "service": "backend", "version": "2.0.0"}

# ── Proxy a orquestador (rate-limited) ────────────────────────────────────────
from fastapi import Depends

@app.post("/infer", tags=["inference"])
@limiter.limit("10/minute")
async def request_inference(
    request: Request,
    user: dict = Depends(require_medico),
):
    """Proxy al orquestador. Rate-limit: 10 inferencias/min/key."""
    body = await request.json()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{settings.ORCHESTRATOR_URL}/infer",
            json={**body, "requested_by": str(user["id"])},
        )
    return r.json()


@app.get("/infer/{task_id}", tags=["inference"])
async def get_inference_status(
    task_id: str,
    user: dict = Depends(require_medico),
):
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{settings.ORCHESTRATOR_URL}/infer/{task_id}")
    return r.json()