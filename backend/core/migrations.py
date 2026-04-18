"""
Run once: python -m core.migrations
Creates all tables (C1 + C2) with pgcrypto extension enabled.
"""
MIGRATION_SQL = """
-- ── Enable extensions ────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── C1: users ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(80) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,                        -- bcrypt
    role            VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN','MEDICO','PACIENTE')),
    access_key      TEXT UNIQUE NOT NULL,                 -- X-Access-Key
    permission_key  TEXT UNIQUE NOT NULL,                 -- X-Permission-Key
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- ── C1: patients ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID REFERENCES users(id),
    fhir_id             TEXT,
    name                VARCHAR(200),
    birth_date          DATE,
    identification_doc  BYTEA,                           -- AES-256 pgcrypto
    medical_summary     BYTEA,                           -- AES-256 pgcrypto
    ground_truth        SMALLINT,                        -- hidden from PACIENTE
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- ── C1: observations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS observations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id  UUID REFERENCES patients(id),
    fhir_id     TEXT,
    loinc_code  VARCHAR(20) NOT NULL,
    value       NUMERIC,
    unit        VARCHAR(20),
    status      VARCHAR(20) DEFAULT 'final',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

-- ── C2: images ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS images (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id  UUID REFERENCES patients(id),
    minio_key   BYTEA NOT NULL,                          -- AES-256 pgcrypto
    modality    VARCHAR(50),
    fhir_media_id TEXT,
    uploaded_by UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

-- ── C2: risk_reports ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID REFERENCES patients(id),
    model_type      VARCHAR(20) CHECK (model_type IN ('ML','DL','MULTIMODAL')),
    risk_score      NUMERIC(5,4),
    risk_category   VARCHAR(20),
    is_critical     BOOLEAN DEFAULT FALSE,
    prediction_enc  BYTEA,                               -- AES-256 pgcrypto
    shap_json       JSONB,
    fhir_risk_id    TEXT,
    doctor_action   VARCHAR(20),                         -- NULL | ACCEPTED | REJECTED
    doctor_notes    TEXT,
    rejection_reason TEXT,
    signed_by       UUID REFERENCES users(id),
    signed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- ── C2: inference_queue ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inference_queue (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id   UUID REFERENCES patients(id),
    model_type   VARCHAR(20),
    status       VARCHAR(20) DEFAULT 'PENDING',
    requested_by UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    result_id    UUID,
    error_msg    TEXT
);

-- ── C2: audit_log (INSERT-ONLY — never UPDATE/DELETE) ───────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ DEFAULT NOW(),
    user_id       UUID,
    role          VARCHAR(20),
    action        VARCHAR(80),
    resource_type VARCHAR(40),
    resource_id   UUID,
    ip_address    INET,
    result        VARCHAR(20),
    detail        JSONB
);

-- ── C2: model_feedback ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_feedback (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    risk_report_id  UUID REFERENCES risk_reports(id),
    doctor_id       UUID REFERENCES users(id),
    feedback        VARCHAR(20),                         -- ACCEPTED | REJECTED
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── C2: consent (Habeas Data Ley 1581/2012) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS consent (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID REFERENCES users(id),
    policy_version VARCHAR(20) DEFAULT '1.0',
    accepted_at    TIMESTAMPTZ DEFAULT NOW(),
    ip_address     INET
);

-- ── C3: patient_assignments (médico ↔ paciente) ──────────────────────────────
CREATE TABLE IF NOT EXISTS patient_assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id  UUID NOT NULL REFERENCES patients(id),
    doctor_id   UUID NOT NULL REFERENCES users(id),
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(patient_id, doctor_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_patients_owner       ON patients(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_observations_pat     ON observations(patient_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_risk_reports_pat     ON risk_reports(patient_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_user       ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action     ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_inference_status     ON inference_queue(status);
CREATE INDEX IF NOT EXISTS idx_assignments_doctor   ON patient_assignments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_assignments_patient  ON patient_assignments(patient_id);
"""

if __name__ == "__main__":
    import asyncio, asyncpg
    from core.config import settings

    async def run():
        conn = await asyncpg.connect(settings.DATABASE_URL)
        await conn.execute(MIGRATION_SQL)
        await conn.close()
        print("✅ Migrations applied successfully")

    asyncio.run(run())