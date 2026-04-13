# 🚀 Guía de Despliegue y Pruebas — Paso a Paso

---

## FASE 0 — Requisitos previos

Instala esto antes de empezar:

```bash
# Verificar instalaciones
docker --version        # necesitas >= 24
docker compose version  # necesitas >= 2.20
python --version        # necesitas >= 3.11
node --version          # necesitas >= 20
git --version
```

Si no tienes alguno:
- Docker Desktop: https://docs.docker.com/desktop/
- Python: https://www.python.org/downloads/
- Node: https://nodejs.org/

---

## FASE 1 — Clonar y configurar el repositorio

```bash
# 1. Clona el repo
git clone <tu-url-github>
cd proyecto-salud-digital-c2

# 2. Verifica que tienes esta estructura
ls
# backend/  dl-service/  frontend/  ml-service/  nginx/
# orchestrator/  scripts/  datasets/  postman/
# docker-compose.yml  README.md
```

---

## FASE 2 — PostgreSQL en Render

**Render es gratis para bases de datos de desarrollo.**

```
1. Ve a https://render.com → Register (gratis)
2. New → PostgreSQL
3. Name: clinai-db
4. Plan: Free
5. Create Database

6. Cuando esté listo, copia "External Database URL":
   postgresql://usuario:contraseña@host.oregon-postgres.render.com/clinai_db
```

Guarda esa URL — la usarás en el siguiente paso.

---

## FASE 3 — Configurar variables de entorno

Copia y llena los .env de cada servicio:

```bash
# Backend
cp backend/.env.example backend/.env
```

Edita `backend/.env`:
```env
DATABASE_URL=postgresql://usuario:pass@host.render.com/clinai_db
AES_KEY=MiClaveAES256MuySegura12345678!  # exactamente 32 caracteres
JWT_SECRET=MiJWTSecretLargoYSeguro2024CliniAI
JWT_EXPIRE_HOURS=8
ALLOWED_ORIGINS=["http://localhost:3000","http://localhost"]
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=clinical-images
ML_SERVICE_URL=http://ml-service:8001
DL_SERVICE_URL=http://dl-service:8002
ORCHESTRATOR_URL=http://orchestrator:8003
```

```bash
# Orchestrator
cp orchestrator/.env.example orchestrator/.env
```

Edita `orchestrator/.env` con los mismos DATABASE_URL y AES_KEY:
```env
DATABASE_URL=postgresql://usuario:pass@host.render.com/clinai_db
ML_SERVICE_URL=http://ml-service:8001
DL_SERVICE_URL=http://dl-service:8002
MAX_WORKERS=4
TASK_TIMEOUT_SECONDS=120
AES_KEY=MiClaveAES256MuySegura12345678!
```

```bash
# ML service
cp ml-service/.env.example ml-service/.env
# (mismo DATABASE_URL)

# DL service
cp dl-service/.env.example dl-service/.env
# (mismo DATABASE_URL y credenciales MinIO)

# Frontend
cp frontend/.env.example frontend/.env
# VITE_API_URL=http://localhost:8000
# VITE_WS_URL=ws://localhost:8003
```

---

## FASE 4 — Descargar datasets

```bash
# Necesitas cuenta en Kaggle
# Ve a https://www.kaggle.com → Account → API → Create New Token
# Descarga kaggle.json y colócalo en ~/.kaggle/kaggle.json

mkdir -p datasets/aptos

# PIMA Diabetes (tabular - ML)
kaggle datasets download -d uciml/pima-indians-diabetes-database
unzip pima-indians-diabetes-database.zip -d datasets/
# Resultado: datasets/diabetes.csv

# APTOS 2019 (imágenes retina - DL)
kaggle competitions download -c aptos2019-blindness-detection
unzip aptos2019-blindness-detection.zip -d datasets/aptos/
# Resultado: datasets/aptos/train.csv + datasets/aptos/train_images/*.png
```

Verifica:
```bash
python -c "
import pandas as pd, pathlib
df = pd.read_csv('datasets/diabetes.csv')
imgs = list(pathlib.Path('datasets/aptos/train_images').glob('*.png'))
print(f'PIMA: {len(df)} filas')
print(f'APTOS: {len(imgs)} imágenes')
"
# PIMA: 768 filas
# APTOS: 3662 imágenes ✅
```

---

## FASE 5 — Entrenar y exportar los modelos de IA

**Esto se hace UNA SOLA VEZ localmente, antes de hacer docker build.**

### 5A — Instalar dependencias de entrenamiento

```bash
pip install xgboost scikit-learn skl2onnx onnxruntime shap \
            pandas numpy mlflow \
            torch torchvision --index-url https://download.pytorch.org/whl/cpu \
            Pillow tqdm
```

### 5B — Entrenar modelo ML (XGBoost → ONNX)

```bash
python ml-service/training/train_and_export.py
```

Espera ver:
```
✅ Metrics: {"f1": 0.72, "auc_roc": 0.84, "precision": 0.71, "recall": 0.73}
✅ Model exported → ml-service/models/ml_model.onnx
✅ Metadata saved → ml-service/models/ml_metadata.json
🎉 Done!
```

### 5C — Entrenar modelo DL (EfficientNet-B0 → ONNX + INT8)

```bash
python dl-service/training/train_and_export.py
```

⚠ Esto tarda 30-60 minutos en CPU. En GPU local tarda ~10 min.

```
# Verás por epoch:
Epoch  1/10 | loss 1.42/1.38 | acc 0.61/0.63 | f1 0.58 | 180s
...
Epoch 10/10 | loss 0.82/0.89 | acc 0.78/0.76 | f1 0.74 | 175s

✅ INT8 model saved → dl-service/models/dl_q8.pth  (18.3 MB)
✅ ONNX model saved → dl-service/models/dl_model.onnx  (20.1 MB)
✅ Metadata → dl-service/models/dl_metadata.json
🎉 Done! Best val F1: 0.7421
```

Verifica que los modelos existen:
```bash
ls ml-service/models/
# ml_model.onnx  ml_metadata.json

ls dl-service/models/
# dl_model.onnx  dl_q8.pth  dl_metadata.json
```

---

## FASE 6 — Primera prueba: solo el backend

Antes de levantar todo, prueba el backend aislado:

```bash
docker compose up backend -d --build

# Espera ~30 segundos y verifica:
docker compose logs backend --tail=20
# Debes ver: "✅ DB pool ready, migrations applied"
# Debes ver: "Uvicorn running on http://0.0.0.0:8000"
```

Abre en el navegador: **http://localhost:8000/docs**

Si ves Swagger UI con los endpoints, el backend funciona ✅

### Crear el primer usuario admin en la BD

Conecta a tu BD de Render (desde el dashboard de Render → Connect → External):

```bash
psql "postgresql://usuario:pass@host.render.com/clinai_db"
```

```sql
-- Genera el hash de contraseña primero en Python:
-- python -c "from passlib.context import CryptContext; print(CryptContext(['bcrypt']).hash('Admin123!@#'))"
-- Copia el hash generado y úsalo abajo:

INSERT INTO users (username, password_hash, role, access_key, permission_key)
VALUES (
  'admin',
  '$2b$12$HASH_GENERADO_AQUI',
  'ADMIN',
  'admin-access-key-001',
  'admin-perm-key-001'
);

INSERT INTO users (username, password_hash, role, access_key, permission_key)
VALUES (
  'medico1',
  '$2b$12$HASH_GENERADO_AQUI',
  'MEDICO',
  'medico1-access-key-001',
  'medico1-perm-key-001'
);

INSERT INTO users (username, password_hash, role, access_key, permission_key)
VALUES (
  'paciente1',
  '$2b$12$HASH_GENERADO_AQUI',
  'PACIENTE',
  'paciente-access-key-001',
  'paciente-perm-key-001'
);
```

Prueba login desde Swagger (`/auth/login`) con los headers:
```
X-Access-Key:     admin-access-key-001
X-Permission-Key: admin-perm-key-001
```

Debes recibir un JWT token ✅

---

## FASE 7 — Probar ml-service aislado

```bash
docker compose up ml-service -d --build

# Verifica
curl http://localhost:8001/health
# {"status":"ok","model_loaded":true} ✅

# Prueba inferencia directa
curl -X POST http://localhost:8001/ml/predict \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "00000000-0000-0000-0000-000000000001",
    "features": {
      "Glucose": 148, "BloodPressure": 72, "BMI": 33.6,
      "Insulin": 0, "Age": 50, "Pregnancies": 6,
      "SkinThickness": 35, "DiabetesPedigreeFunction": 0.627
    }
  }'

# Debes ver en < 3 segundos:
# {"risk_score": 0.78, "risk_category": "HIGH", "shap_values": {...}, ...} ✅
```

---

## FASE 8 — Levantar TODO

Una vez que el backend y ml-service funcionen por separado:

```bash
# Bajar lo que tenías levantado
docker compose down

# Levantar todos los servicios
docker compose up -d --build

# Ver el progreso (espera ~2 minutos)
docker compose ps
```

Debes ver algo así:
```
NAME            STATUS          PORTS
backend         Up (healthy)    8000/tcp
dl-service      Up              8002/tcp
frontend        Up              3000/tcp
mailhog         Up              1025/tcp, 8025/tcp
minio           Up              9000-9001/tcp
minio-init      Exited (0)      ← corrió y terminó, es normal
ml-service      Up              8001/tcp
mlflow          Up              5000/tcp
nginx           Up              0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
orchestrator    Up              8003/tcp
```

### Verificar todos los health checks:

```bash
curl http://localhost:8000/health   # backend
curl http://localhost:8001/health   # ml-service
curl http://localhost:8002/health   # dl-service
curl http://localhost:8003/health   # orchestrator

# Todos deben responder: {"status":"ok"} ✅
```

---

## FASE 9 — Seed de pacientes

Con todo el sistema levantado:

```bash
# Configura las credenciales del médico
export API_URL="http://localhost:8000"
export ACCESS_KEY="medico1-access-key-001"
export PERM_KEY="medico1-perm-key-001"

# Corre el seed
python scripts/seed_patients.py
```

Debes ver:
```
🔐 Logging in...
✅ Authenticated
📷 Found 15 APTOS retina images
  [  1] ✅ María García López (GT=1) + retina
  [  2] ✅ Carlos Rodríguez Pérez (GT=0)
  ...
  [ 30] ✅ Ana Martínez Gómez (GT=1) + retina

🎉 Seed complete!
   Patients created : 30
   With retina image: 15
   Errors           : 0 ✅
```

---

## FASE 10 — Probar el flujo completo en Postman

### Importar la colección:
1. Abre Postman
2. Import → File → `postman/corte2.json`
3. La colección aparece como "ClinAI — Corte 2"

### Flujo de prueba en orden:

```
1. 🔐 Auth → "Login — Médico 1"
   → Guarda el token automáticamente en la variable {{token}}

2. 🔐 Auth → "Habeas Data — Aceptar"
   → Registra consentimiento Ley 1581/2012

3. 👥 FHIR Patient → "Listar pacientes (paginado)"
   → Verifica paginación + guarda {{patient_id}} del primero

4. 📊 FHIR Observation → "Listar Observations del paciente"
   → Verifica que hay datos LOINC

5. 🤖 Inferencia ML → "POST inferencia ML — solicitar"
   → Recibe task_id, status: PENDING

6. 🤖 Inferencia ML → "GET task status — polling"
   → Espera hasta status: DONE
   → Guarda {{report_id}} automáticamente

7. ✍ RiskReport → "PATCH firma RiskReport — ACEPTAR"
   → Firma con observaciones ≥ 30 chars

8. ✍ RiskReport → "Bloqueo 409 — cerrar sin firma"
   → Si hay pendientes: 409 PENDING_SIGNATURE ✅
   → Si está firmado: 200 can_close: true ✅

9. 🔒 Admin → "GET audit log filtrado"
   → Verifica registro de todas las acciones

10. 🔒 Admin → "GET audit log — exportar JSON"
    → Descarga el log completo
```

---

## FASE 11 — Probar el frontend

Abre el navegador en: **http://localhost**

### Flujo completo de la demo:

```
1. LOGIN
   - Ingresa: X-Access-Key = medico1-access-key-001
   - Ingresa: X-Permission-Key = medico1-perm-key-001
   - Clic "Ingresar al Sistema"

2. HABEAS DATA (si es primer acceso)
   - Lee la política de privacidad
   - Marca la casilla de aceptación
   - Clic "Acepto y Continuar"

3. DASHBOARD
   - Verifica tabla paginada con 30 pacientes
   - Verifica dots de riesgo de colores
   - Filtra por "Pendiente" o busca por nombre
   - Clic en cualquier paciente

4. FICHA CLÍNICA
   - Verifica datos FHIR del paciente
   - Verifica gráfica Recharts con observaciones LOINC
   - Ve al tab "Imágenes" — verifica imagen retina
   - Activa "Ver Grad-CAM" si hay resultado DL

5. ANÁLISIS IA
   - Tab "Análisis IA"
   - Selecciona "Tabular ML"
   - Clic "▶ Ejecutar análisis"
   - Observa polling → PENDING → RUNNING → DONE
   - Ve resultado con risk_score y SHAP values

6. FIRMA
   - Tab "RiskReports"
   - Escribe observaciones clínicas (≥ 30 chars)
   - Clic "✅ Aceptar diagnóstico"
   - Clic "✍ Confirmar firma"

7. CIERRE
   - Clic "✓ Cerrar paciente"
   - Si hay sin firmar: bloqueo ✅
   - Si está firmado: navega al dashboard ✅
```

---

## FASE 12 — Probar concurrencia del orquestador

```bash
# Lanza 4 inferencias simultáneas
for i in 1 2 3 4; do
  curl -s -X POST http://localhost:8000/infer \
    -H "Authorization: Bearer TU_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"patient_id\": \"PATIENT_UUID_$i\", \"model_type\": \"ML\"}" &
done
wait

# Verifica en los logs que corren en paralelo:
docker compose logs orchestrator --tail=30
# Debes ver 4 tareas con status RUNNING simultáneamente ✅
```

---

## Comandos útiles del día a día

```bash
# Ver logs de un servicio
docker compose logs backend -f
docker compose logs ml-service -f --tail=50

# Reiniciar un servicio sin bajar todo
docker compose restart backend

# Ver estado de todos los servicios
docker compose ps

# Entrar al contenedor del backend
docker compose exec backend bash

# Ver tablas en la BD
docker compose exec backend python -c "
import asyncio, asyncpg
async def check():
    conn = await asyncpg.connect('$DATABASE_URL')
    tables = await conn.fetch(\"SELECT tablename FROM pg_tables WHERE schemaname='public'\")
    for t in tables: print(t['tablename'])
    await conn.close()
asyncio.run(check())
"

# Probar WebSocket del orquestador (necesitas wscat)
npm install -g wscat
wscat -c "ws://localhost:8003/ws/infer/TASK_UUID"

# Bajar todo
docker compose down

# Bajar y limpiar volúmenes (⚠ borra imágenes MinIO)
docker compose down -v
```

---

## Checklist final antes de la demo

```
☐ docker compose up -d  → todos los servicios healthy
☐ http://localhost/docs  → Swagger visible
☐ http://localhost  → Frontend carga login
☐ Login con medico1 → funciona + Habeas Data modal
☐ Dashboard → 30+ pacientes visibles
☐ Inferencia ML → PENDING → DONE en < 10s
☐ Inferencia DL → PENDING → DONE en < 30s
☐ Firma RiskReport → bloqueo 409 verificado
☐ Admin → audit log con 10+ tipos de evento
☐ Export audit log → CSV y JSON descargan
☐ Colección Postman → todos los tests en verde
☐ seed_patients.py → 30 pacientes, 15 con imagen
☐ .gitignore → .env, *.onnx, *.pth NO están en el repo
```

---

## ⚠ Errores comunes y soluciones

| Error | Causa probable | Solución |
|-------|---------------|----------|
| `model not found` al arrancar ml-service | No corriste train_and_export.py | `python ml-service/training/train_and_export.py` |
| `Connection refused` al backend | DATABASE_URL mal configurada en .env | Verifica la URL de Render, sin espacios |
| `compose up` falla en build | Node modules no instalados en frontend | Están en el Dockerfile, se instalan automáticamente |
| `CUDA not available` en dl-service | Torch con CUDA instalado | Usa el index-url CPU: `--index-url https://download.pytorch.org/whl/cpu` |
| `429 Too Many Requests` en /infer | Rate limit 10/min activo | Espera 1 min. Es correcto |
| `409 PENDING_SIGNATURE` al cerrar | RiskReport sin firmar | Ve al tab Reportes y firma |
| Frontend no carga imágenes | MinIO no tiene el bucket | `docker compose restart minio-init` |
| `SSL error` en nginx | Faltan certificados self-signed | Ver sección de certificados abajo |

### Generar certificados SSL para desarrollo:

```bash
mkdir -p nginx/certs
openssl req -x509 -newkey rsa:4096 -keyout nginx/certs/key.pem \
  -out nginx/certs/cert.pem -days 365 -nodes \
  -subj "/CN=localhost"
```