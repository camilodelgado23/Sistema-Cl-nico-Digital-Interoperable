"""
scripts/seed_patients.py
Genera ≥ 30 pacientes sintéticos desde PIMA Diabetes + imágenes APTOS 2019.

Requisitos:
  pip install pandas faker minio requests

Uso (con el sistema levantado):
  python scripts/seed_patients.py

Variables de entorno (o editar constantes abajo):
  API_URL     → http://localhost:8000 (o URL de Render)
  ACCESS_KEY  → X-Access-Key del usuario MEDICO
  PERM_KEY    → X-Permission-Key del usuario MEDICO
"""
import os, pathlib, time
import pandas as pd
from faker import Faker
from minio import Minio
import requests

# ── Config ────────────────────────────────────────────────────────────────────
API_URL    = os.getenv("API_URL",    "http://localhost:8000")
ACCESS_KEY = os.getenv("ACCESS_KEY", "d13e4618e587c3d42ece96cadcc30b37")
PERM_KEY   = os.getenv("PERM_KEY",   "d7146f286875d1e9c3018e18cff4750d")

MINIO_ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY",  "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY",  "minioadmin")
MINIO_BUCKET     = "clinical-images"

DIABETES_CSV = pathlib.Path("datasets/diabetes.csv")
APTOS_DIR    = pathlib.Path("datasets/aptos/train_images")
APTOS_CSV    = pathlib.Path("datasets/aptos/train.csv")

MIN_PATIENTS  = 30
MIN_WITH_IMG  = 15

# ── LOINC mapping — must match ml-service/training/train_and_export.py ────────
LOINC = {
    "Glucose":                  "2339-0",
    "BloodPressure":            "55284-4",
    "BMI":                      "39156-5",
    "Insulin":                  "14749-6",
    "Age":                      "21612-7",
    "Pregnancies":              "11996-6",
    "SkinThickness":            "39106-0",
    "DiabetesPedigreeFunction": "33914-3",
}

UNIT_MAP = {
    "Glucose":                  "mg/dL",
    "BloodPressure":            "mmHg",
    "BMI":                      "kg/m2",
    "Insulin":                  "uU/mL",
    "Age":                      "a",
    "Pregnancies":              "{count}",
    "SkinThickness":            "mm",
    "DiabetesPedigreeFunction": "{score}",
}

faker = Faker("es_CO")


def login() -> str:
    r = requests.post(
        f"{API_URL}/auth/login",
        headers={"X-Access-Key": ACCESS_KEY, "X-Permission-Key": PERM_KEY},
    )
    r.raise_for_status()
    return r.json()["access_token"]


def create_patient(token: str, name: str, birth_date: str,
                   id_doc: str, ground_truth: int) -> str:
    r = requests.post(
        f"{API_URL}/fhir/Patient",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json={"name": name, "birth_date": birth_date,
              "identification_doc": id_doc, "ground_truth": ground_truth},
    )
    r.raise_for_status()
    return r.json()["id"]


def create_observation(token: str, patient_id: str,
                       loinc_code: str, value: float, unit: str):
    r = requests.post(
        f"{API_URL}/fhir/Observation",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json={"patient_id": patient_id, "loinc_code": loinc_code,
              "value": value, "unit": unit, "status": "final"},
    )
    r.raise_for_status()


def upload_image_to_minio(mc: Minio, patient_id: str,
                          img_path: pathlib.Path) -> str:
    key = f"patients/{patient_id}/retina.png"
    mc.fput_object(MINIO_BUCKET, key, str(img_path),
                   content_type="image/png")
    return key


def create_media(token: str, patient_id: str, minio_key: str):
    r = requests.post(
        f"{API_URL}/fhir/Media",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json={"patient_id": patient_id, "minio_key": minio_key,
              "modality": "FUNDUS"},
    )
    r.raise_for_status()


def main():
    # Validate dataset files
    if not DIABETES_CSV.exists():
        raise FileNotFoundError(
            f"Missing {DIABETES_CSV}\n"
            "Download: https://www.kaggle.com/datasets/uciml/pima-indians-diabetes-database"
        )

    df     = pd.read_csv(DIABETES_CSV)
    # Replace zeros with median (same imputation as training)
    for col in ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]:
        df[col] = df[col].replace(0, df[col].median())
    df = df.head(max(MIN_PATIENTS, 50))   # use first 50 rows

    # APTOS images (optional — only if available)
    aptos_imgs = []
    if APTOS_DIR.exists():
        aptos_imgs = sorted(APTOS_DIR.glob("*.png"))[:MIN_WITH_IMG + 5]
        print(f"📷 Found {len(aptos_imgs)} APTOS retina images")
    else:
        print(f"⚠️  APTOS images not found at {APTOS_DIR} — patients will have no images")

    # MinIO client
    mc = Minio(MINIO_ENDPOINT, access_key=MINIO_ACCESS_KEY,
               secret_key=MINIO_SECRET_KEY, secure=False)
    if not mc.bucket_exists(MINIO_BUCKET):
        mc.make_bucket(MINIO_BUCKET)

    # Login
    print("🔐 Logging in...")
    token = login()
    print("✅ Authenticated")

    created = 0
    with_img = 0
    errors   = 0

    for i, row in df.iterrows():
        try:
            # Generate synthetic demographics (Colombian locale)
            name       = faker.name()
            birth_date = str(faker.date_of_birth(minimum_age=20, maximum_age=70))
            id_doc     = faker.numerify("##########")
            gt         = int(row["Outcome"])

            # 1. Create FHIR Patient
            pid = create_patient(token, name, birth_date, id_doc, gt)

            # 2. Create Observations (one per feature, LOINC coded)
            for col, loinc_code in LOINC.items():
                if col in row and pd.notna(row[col]):
                    create_observation(token, pid, loinc_code,
                                       float(row[col]), UNIT_MAP[col])

            # 3. Upload retina image to MinIO + create Media FHIR
            if with_img < len(aptos_imgs):
                img_path = aptos_imgs[with_img]
                minio_key = upload_image_to_minio(mc, pid, img_path)
                create_media(token, pid, minio_key)
                with_img += 1

            created += 1
            print(f"  [{created:3d}] ✅ {name} (GT={gt})"
                  f"{' + retina' if with_img > created - 1 else ''}")

            time.sleep(0.05)   # avoid hammering the API

        except Exception as e:
            errors += 1
            print(f"  [{i}] ❌ Error: {e}")

    print(f"\n🎉 Seed complete!")
    print(f"   Patients created : {created}")
    print(f"   With retina image: {with_img}")
    print(f"   Errors           : {errors}")

    if created < MIN_PATIENTS:
        print(f"\n⚠️  Only {created} patients created — need ≥ {MIN_PATIENTS}")
    if with_img < MIN_WITH_IMG:
        print(f"⚠️  Only {with_img} with images — need ≥ {MIN_WITH_IMG}")
        print("   Download APTOS images from Kaggle and re-run")


if __name__ == "__main__":
    main()