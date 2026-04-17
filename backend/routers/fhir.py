"""
routers/fhir.py — FHIR R4 resources
Patient, Observation, Media, RiskAssessment, DiagnosticReport, AuditEvent
All endpoints: doble API-Key (via JWT) + RBAC + audit log + paginación.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional
import asyncpg, uuid
from datetime import date, datetime, timedelta
from core.config import get_db
from core.auth import require_authenticated, require_medico, require_admin
from core.audit import log_audit
from core.crypto import encrypt_value, decrypt_value
from fastapi import UploadFile, File, Form
from minio import Minio
import io as _io
from minio import Minio as _Minio

router = APIRouter(prefix="/fhir", tags=["FHIR"])


# ──────────────────────────────────────────────────────────────────────────────
# PATIENT
# ──────────────────────────────────────────────────────────────────────────────
class PatientCreate(BaseModel):
    name: str
    birth_date: str
    identification_doc: str
    ground_truth: Optional[int] = None  # hidden from PACIENTE role


@router.post("/Patient", status_code=201)
async def create_patient(
    body: PatientCreate,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    enc_doc = await encrypt_value(db, body.identification_doc)
    birth_date_obj = datetime.strptime(body.birth_date, "%Y-%m-%d").date() if isinstance(body.birth_date, str) else body.birth_date
    row = await db.fetchrow(
        """INSERT INTO patients (owner_id, name, birth_date, identification_doc, ground_truth)
        VALUES ($1::uuid, $2, $3, $4, $5)
        RETURNING id, name, birth_date, created_at""",
        str(user["id"]), body.name, birth_date_obj, enc_doc, body.ground_truth,
    )
    pid = str(row["id"])
    await log_audit(db, str(user["id"]), user["role"], "CREATE_PATIENT", "Patient",
                    pid, request.client.host if request.client else None)
    return _patient_to_fhir(row)


@router.get("/Patient")
async def list_patients(
    request: Request,
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    # Role-based visibility
    if user["role"] == "ADMIN":
        where, params = "WHERE p.deleted_at IS NULL", []
    elif user["role"] == "MEDICO":
        where, params = "WHERE p.deleted_at IS NULL AND p.owner_id = $1::uuid", [str(user["id"])]
    else:  # PACIENTE
        where, params = "WHERE p.deleted_at IS NULL AND p.owner_id = $1::uuid", [str(user["id"])]

    count_row = await db.fetchrow(f"SELECT COUNT(*) FROM patients p {where}", *params)
    rows = await db.fetch(
        f"""SELECT p.id, p.name, p.birth_date, p.created_at,
                   (SELECT COUNT(*) FROM risk_reports r
                    WHERE r.patient_id = p.id AND r.deleted_at IS NULL AND r.signed_at IS NULL) AS pending_reports,
                   (SELECT risk_category FROM risk_reports r
                    WHERE r.patient_id = p.id AND r.deleted_at IS NULL
                    ORDER BY r.created_at DESC LIMIT 1) AS last_risk_category
            FROM patients p {where}
            ORDER BY p.created_at DESC
            LIMIT ${len(params)+1} OFFSET ${len(params)+2}""",
        *params, limit, offset,
    )
    await log_audit(db, str(user["id"]), user["role"], "LIST_PATIENTS", "Patient",
                    None, request.client.host if request.client else None)
    return {
        "total": count_row["count"],
        "limit": limit,
        "offset": offset,
        "entry": [_patient_list_entry(r) for r in rows],
    }


@router.get("/Patient/{pid}")
async def get_patient(
    pid: str,
    request: Request,
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    row = await db.fetchrow(
        "SELECT * FROM patients WHERE id = $1::uuid AND deleted_at IS NULL", pid
    )
    if not row:
        raise HTTPException(404, "Paciente no encontrado")
    _check_patient_access(user, row)

    dec_doc = await decrypt_value(db, row["identification_doc"])
    await log_audit(db, str(user["id"]), user["role"], "VIEW_PATIENT", "Patient",
                    pid, request.client.host if request.client else None)
    fhir = _patient_to_fhir(row)
    fhir["identification_doc"] = dec_doc if user["role"] != "PACIENTE" else "***"
    # Hide ground_truth from PACIENTE
    if user["role"] == "PACIENTE":
        fhir.pop("ground_truth", None)
    return fhir


@router.delete("/Patient/{pid}", status_code=204)
async def soft_delete_patient(
    pid: str,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    await db.execute(
        "UPDATE patients SET deleted_at = NOW() WHERE id = $1::uuid AND deleted_at IS NULL", pid
    )
    await log_audit(db, str(user["id"]), user["role"], "DELETE_USER", "Patient",
                    pid, request.client.host if request.client else None)


@router.patch("/Patient/{pid}/restore", status_code=200)
async def restore_patient(
    pid: str,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    await db.execute(
        "UPDATE patients SET deleted_at = NULL WHERE id = $1::uuid", pid
    )
    return {"restored": pid}


# ──────────────────────────────────────────────────────────────────────────────
# OBSERVATION
# ──────────────────────────────────────────────────────────────────────────────
class ObservationCreate(BaseModel):
    patient_id: str
    loinc_code: str
    value: float
    unit: str
    status: str = "final"


@router.post("/Observation", status_code=201)
async def create_observation(
    body: ObservationCreate,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    row = await db.fetchrow(
        """INSERT INTO observations (patient_id, loinc_code, value, unit, status)
           VALUES ($1::uuid, $2, $3, $4, $5)
           RETURNING id, patient_id, loinc_code, value, unit, status, created_at""",
        body.patient_id, body.loinc_code, body.value, body.unit, body.status,
    )
    return _observation_to_fhir(row)


@router.get("/Observation")
async def list_observations(
    subject: str = Query(..., description="Patient UUID"),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    _check_subject_access(user, subject)
    rows = await db.fetch(
        """SELECT * FROM observations
           WHERE patient_id = $1::uuid AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
        subject, limit, offset,
    )
    count = await db.fetchval(
        "SELECT COUNT(*) FROM observations WHERE patient_id = $1::uuid AND deleted_at IS NULL",
        subject,
    )
    return {
        "total": count, "limit": limit, "offset": offset,
        "entry": [_observation_to_fhir(r) for r in rows],
    }


# ──────────────────────────────────────────────────────────────────────────────
# MEDIA (images → MinIO)
# ──────────────────────────────────────────────────────────────────────────────
class MediaCreate(BaseModel):
    patient_id: str
    minio_key: str          # plain key — will be encrypted
    modality: str           # FUNDUS, XRAY, DERM, etc.


@router.post("/Media", status_code=201)
async def create_media(
    body: MediaCreate,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    enc_key = await encrypt_value(db, body.minio_key)
    row = await db.fetchrow(
        """INSERT INTO images (patient_id, minio_key, modality, uploaded_by)
           VALUES ($1::uuid, $2, $3, $4::uuid)
           RETURNING id, patient_id, modality, created_at""",
        body.patient_id, enc_key, body.modality, str(user["id"]),
    )
    await log_audit(db, str(user["id"]), user["role"], "UPLOAD_IMAGE", "Media",
                    str(row["id"]), request.client.host if request.client else None)
    return _media_to_fhir(row, body.minio_key)


@router.get("/Media")
async def list_media(
    subject: str = Query(...),
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    presign: bool = Query(False),
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    _check_subject_access(user, subject)
    rows = await db.fetch(
        """SELECT i.id, i.patient_id, i.minio_key, i.modality, i.created_at
           FROM images i
           WHERE i.patient_id = $1::uuid AND i.deleted_at IS NULL
           ORDER BY i.created_at DESC LIMIT $2 OFFSET $3""",
        subject, limit, offset,
    )
    total = await db.fetchval(
        "SELECT COUNT(*) FROM images WHERE patient_id = $1::uuid AND deleted_at IS NULL", subject
    )
    result = []
    mc = _get_minio() if presign else None
    for r in rows:
        plain_key = await decrypt_value(db, r["minio_key"])
        entry = _media_to_fhir(r, plain_key)
        if presign and mc:
            try:
                from core.config import settings as _s
                url = mc.presigned_get_object(_s.MINIO_BUCKET, plain_key, expires=timedelta(hours=1))
                entry["presigned_url"] = url
                entry["content"]["url"] = url
            except Exception as e:
                entry["presigned_url"] = None
        result.append(entry)
    return {"total": total, "limit": limit, "offset": offset, "entry": result}


# ──────────────────────────────────────────────────────────────────────────────
# RISK ASSESSMENT (sign endpoint)
# ──────────────────────────────────────────────────────────────────────────────
class SignRiskReport(BaseModel):
    action: str                 # ACCEPTED | REJECTED
    doctor_notes: str
    rejection_reason: Optional[str] = None


@router.patch("/RiskAssessment/{rid}/sign")
async def sign_risk_report(
    rid: str,
    body: SignRiskReport,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    if body.action not in ("ACCEPTED", "REJECTED"):
        raise HTTPException(400, "action debe ser ACCEPTED o REJECTED")
    if len(body.doctor_notes) < 30:
        raise HTTPException(400, "doctor_notes debe tener al menos 30 caracteres")
    if body.action == "REJECTED":
        if not body.rejection_reason or len(body.rejection_reason) < 20:
            raise HTTPException(400, "rejection_reason obligatorio (≥ 20 chars) si REJECTED")

    row = await db.fetchrow(
        "SELECT id, patient_id, signed_at FROM risk_reports WHERE id = $1::uuid AND deleted_at IS NULL",
        rid,
    )
    if not row:
        raise HTTPException(404, "RiskReport no encontrado")
    if row["signed_at"] is not None:
        raise HTTPException(409, "RiskReport ya fue firmado")

    updated = await db.fetchrow(
        """UPDATE risk_reports
           SET doctor_action = $1, doctor_notes = $2, rejection_reason = $3,
               signed_by = $4::uuid, signed_at = NOW()
           WHERE id = $5::uuid
           RETURNING id, patient_id, doctor_action, signed_at""",
        body.action, body.doctor_notes, body.rejection_reason,
        str(user["id"]), rid,
    )

    # Save feedback
    await db.execute(
        """INSERT INTO model_feedback (risk_report_id, doctor_id, feedback, notes)
           VALUES ($1::uuid, $2::uuid, $3, $4)""",
        rid, str(user["id"]), body.action, body.doctor_notes,
    )

    await log_audit(db, str(user["id"]), user["role"], "SIGN_REPORT", "RiskAssessment",
                    rid, request.client.host if request.client else None,
                    detail={"action": body.action})

    return {
        "resourceType": "RiskAssessment",
        "id": str(updated["id"]),
        "patient": {"reference": f"Patient/{updated['patient_id']}"},
        "performer": {"reference": f"Practitioner/{user['id']}"},
        "signed_at": updated["signed_at"].isoformat(),
        "doctor_action": updated["doctor_action"],
    }


@router.get("/RiskAssessment")
async def list_risk_assessments(
    subject: str = Query(...),
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    _check_subject_access(user, subject)
    rows = await db.fetch(
        """SELECT id, patient_id, model_type, risk_score, risk_category,
                  is_critical, shap_json, doctor_action, signed_at, created_at
           FROM risk_reports
           WHERE patient_id = $1::uuid AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
        subject, limit, offset,
    )
    return {
        "total": len(rows), "limit": limit, "offset": offset,
        "entry": [_risk_to_fhir(r) for r in rows],
    }


# ──────────────────────────────────────────────────────────────────────────────
# CAN CLOSE PATIENT (bloqueo de cierre — 409 si hay reportes sin firma)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/Patient/{pid}/can-close")
async def can_close_patient(
    pid: str,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    pending = await db.fetch(
        """SELECT id FROM risk_reports
           WHERE patient_id = $1::uuid AND signed_at IS NULL AND deleted_at IS NULL""",
        pid,
    )
    if pending:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "PENDING_SIGNATURE",
                "message": "Debe firmar el RiskReport antes de cerrar el paciente",
                "pending_count": len(pending),
            },
        )
    await log_audit(db, str(user["id"]), user["role"], "CLOSE_PATIENT", "Patient",
                    pid, request.client.host if request.client else None)
    return {"can_close": True, "message": "Paciente puede ser cerrado"}


# ──────────────────────────────────────────────────────────────────────────────
# HELPERS — resource mappers
# ──────────────────────────────────────────────────────────────────────────────
def _patient_to_fhir(row) -> dict:
    return {
        "resourceType": "Patient",
        "id": str(row["id"]),
        "name": row["name"],
        "birthDate": str(row["birth_date"]) if row.get("birth_date") else None,
        "active": row.get("is_active", True),
        "meta": {"createdAt": row["created_at"].isoformat()},
    }

def _patient_list_entry(row) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "birth_date": str(row["birth_date"]) if row.get("birth_date") else None,
        "pending_reports": row.get("pending_reports", 0),
        "last_risk_category": row.get("last_risk_category"),
    }

def _observation_to_fhir(row) -> dict:
    return {
        "resourceType": "Observation",
        "id": str(row["id"]),
        "subject": {"reference": f"Patient/{row['patient_id']}"},
        "status": row["status"],
        "code": {"coding": [{"system": "http://loinc.org", "code": row["loinc_code"]}]},
        "valueQuantity": {"value": float(row["value"]), "unit": row["unit"]},
        "effectiveDateTime": row["created_at"].isoformat(),
    }

def _media_to_fhir(row, plain_minio_key: str) -> dict:
    return {
        "resourceType": "Media",
        "id": str(row["id"]),
        "subject": {"reference": f"Patient/{row['patient_id']}"},
        "status": "completed",
        "modality": row["modality"],
        "content": {"url": f"/minio/{plain_minio_key}"},
        "createdDateTime": row["created_at"].isoformat(),
    }

def _risk_to_fhir(row) -> dict:
    snomed_map = {
        "LOW": "281414001", "MEDIUM": "281415000",
        "HIGH": "281416004", "CRITICAL": "24484000",
    }
    cat = row.get("risk_category", "LOW")
    return {
        "resourceType": "RiskAssessment",
        "id": str(row["id"]),
        "subject": {"reference": f"Patient/{row['patient_id']}"},
        "method": row.get("model_type"),
        "prediction": [{
            "probabilityDecimal": float(row["risk_score"]) if row.get("risk_score") else None,
            "qualitativeRisk": {
                "coding": [{"system": "http://snomed.info/sct",
                            "code": snomed_map.get(cat, "281414001"),
                            "display": cat}]
            },
        }],
        "is_critical": row.get("is_critical", False),
        "shap_values": row.get("shap_json"),
        "doctor_action": row.get("doctor_action"),
        "signed_at": row["signed_at"].isoformat() if row.get("signed_at") else None,
        "occurrenceDateTime": row["created_at"].isoformat(),
    }

def _check_patient_access(user: dict, row):
    if user["role"] == "PACIENTE" and str(row["owner_id"]) != str(user["id"]):
        raise HTTPException(403, "Acceso denegado a este paciente")

def _check_subject_access(user: dict, subject_id: str):
    if user["role"] == "PACIENTE" and str(user["id"]) != subject_id:
        raise HTTPException(403, "Solo puede ver sus propios datos")
    
# Agrega la función helper y el endpoint al FINAL del archivo fhir.py:
 
def _get_minio():
    from core.config import settings
    return Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=False,
    )
 
@router.post("/Media/upload", status_code=201)
async def upload_media_file(
    request: Request,
    patient_id: str = Form(...),
    modality: str = Form("FUNDUS"),
    file: UploadFile = File(...),
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    allowed = {"image/jpeg", "image/png", "image/jpg"}
    if file.content_type not in allowed:
        raise HTTPException(400, "Solo se permiten imágenes JPG/PNG")
 
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "Imagen demasiado grande (máx 10 MB)")
 
    from core.config import settings
    minio_key = f"patients/{patient_id}/{file.filename}"
    mc = _get_minio()
 
    if not mc.bucket_exists(settings.MINIO_BUCKET):
        mc.make_bucket(settings.MINIO_BUCKET)
 
    mc.put_object(
        settings.MINIO_BUCKET,
        minio_key,
        _io.BytesIO(content),
        length=len(content),
        content_type=file.content_type,
    )
 
    enc_key = await encrypt_value(db, minio_key)
    row = await db.fetchrow(
        """INSERT INTO images (patient_id, minio_key, modality, uploaded_by)
           VALUES ($1::uuid, $2, $3, $4::uuid)
           RETURNING id, patient_id, modality, created_at""",
        patient_id, enc_key, modality, str(user["id"]),
    )
    await log_audit(db, str(user["id"]), user["role"], "UPLOAD_IMAGE", "Media",
                    str(row["id"]), request.client.host if request.client else None)
    return _media_to_fhir(row, minio_key)

def _minio_client():
    from core.config import settings
    return _Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=False,
    )


@router.get("/Media/{media_id}/url")
async def get_media_presigned_url(
    media_id: str,
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    from core.config import settings
    from datetime import timedelta

    row = await db.fetchrow(
        """SELECT id, patient_id, minio_key, modality 
           FROM images 
           WHERE id = $1::uuid AND deleted_at IS NULL""",
        media_id,
    )

    if not row:
        raise HTTPException(404, "Imagen no encontrada")

    plain_key = await decrypt_value(db, row["minio_key"])
    mc = _minio_client()

    try:
        url = mc.presigned_get_object(
            settings.MINIO_BUCKET,
            plain_key,
            expires=timedelta(hours=1),
        )
    except Exception as e:
        raise HTTPException(500, f"Error generando URL: {e}")

    return {
        "id": media_id,
        "url": url,
        "modality": row["modality"],
        "expires_in": 3600,
    }

# ──────────────────────────────────────────────────────────────────────────────
# GET /fhir/RiskAssessment/{rid}  — reporte individual
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/RiskAssessment/{rid}")
async def get_risk_assessment(
    rid: str,
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    row = await db.fetchrow(
        """SELECT id, patient_id, model_type, risk_score, risk_category,
                  is_critical, shap_json, doctor_action, doctor_notes,
                  rejection_reason, signed_by, signed_at, created_at
           FROM risk_reports
           WHERE id = $1::uuid AND deleted_at IS NULL""",
        rid,
    )
    if not row:
        raise HTTPException(404, "RiskReport no encontrado")
    _check_subject_access(user, str(row["patient_id"]))
    return _risk_to_fhir(row)


# ──────────────────────────────────────────────────────────────────────────────
# POST /fhir/Patient/full  — crea paciente + observaciones en un solo call
# ──────────────────────────────────────────────────────────────────────────────
class ObsItem(BaseModel):
    loinc_code: str
    value: float
    unit: str

class PatientFull(BaseModel):
    name: str
    birth_date: str
    identification_doc: str
    ground_truth: Optional[int] = None
    observations: list[ObsItem] = []

@router.post("/Patient/full", status_code=201)
async def create_patient_full(
    body: PatientFull,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    """Crea paciente FHIR completo con observaciones LOINC en una sola llamada."""
    enc_doc = await encrypt_value(db, body.identification_doc)
    birth_date_obj = datetime.strptime(body.birth_date, "%Y-%m-%d").date()
    row = await db.fetchrow(
        """INSERT INTO patients (owner_id, name, birth_date, identification_doc, ground_truth)
           VALUES ($1::uuid, $2, $3, $4, $5)
           RETURNING id, name, birth_date, created_at""",
        str(user["id"]), body.name, birth_date_obj, enc_doc, body.ground_truth,
    )
    pid = str(row["id"])
    obs_created = []
    for obs in body.observations:
        obs_row = await db.fetchrow(
            """INSERT INTO observations (patient_id, loinc_code, value, unit, status)
               VALUES ($1::uuid, $2, $3, $4, 'final')
               RETURNING id, loinc_code, value, unit""",
            pid, obs.loinc_code, obs.value, obs.unit,
        )
        obs_created.append(dict(obs_row))
    await log_audit(
        db, str(user["id"]), user["role"], "CREATE_PATIENT", "Patient",
        pid, request.client.host if request.client else None,
        detail={"observations_count": len(obs_created)},
    )
    return {
        "resourceType": "Patient",
        "id": pid,
        "name": row["name"],
        "birthDate": str(row["birth_date"]),
        "meta": {"createdAt": row["created_at"].isoformat()},
        "observations_created": len(obs_created),
    }