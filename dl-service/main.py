"""
dl-service/main.py
FastAPI — Inferencia EfficientNet-B0 ONNX/INT8 + Grad-CAM → MinIO
Tiempo máximo CPU: < 15 segundos
"""
import io, json, os, time, pathlib
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import asyncpg
import numpy as np
import onnxruntime as ort
from PIL import Image
import torch
import torch.nn as nn
from torchvision import models, transforms
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from minio import Minio

# ── Config ────────────────────────────────────────────────────────────────────
MODELS_DIR    = pathlib.Path(__file__).parent / "models"
ONNX_PATH     = MODELS_DIR / "dl_model.onnx"
Q8_PATH       = MODELS_DIR / "dl_q8.pth"
META_PATH     = MODELS_DIR / "dl_metadata.json"
DATABASE_URL  = os.getenv("DATABASE_URL")
MINIO_ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY",  "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY",  "minioadmin")
MINIO_BUCKET     = os.getenv("MINIO_BUCKET",       "clinical-images")
PRESIGN_EXPIRY   = int(os.getenv("PRESIGN_EXPIRY_SECONDS", "3600"))

# ── Globals ───────────────────────────────────────────────────────────────────
_ort_sess:  ort.InferenceSession | None = None
_torch_model: nn.Module | None = None
_meta:      dict = {}
_pool:      asyncpg.Pool | None = None
_mc:        Minio | None = None
_use_onnx:  bool = True

# ── Image preprocessing ───────────────────────────────────────────────────────
_preprocess = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _ort_sess, _torch_model, _meta, _pool, _mc, _use_onnx

    # Load metadata
    if META_PATH.exists():
        with open(META_PATH) as f:
            _meta = json.load(f)

    # Try ONNX first
    if ONNX_PATH.exists():
        _ort_sess = ort.InferenceSession(
            str(ONNX_PATH),
            providers=["CPUExecutionProvider"],   # NO CUDA
        )
        _use_onnx = True
        print(f"✅ ONNX model loaded: {ONNX_PATH}")
    elif Q8_PATH.exists():
        # Fallback to INT8 PyTorch
        _torch_model = _load_torch_q8(Q8_PATH)
        _use_onnx = False
        print(f"✅ INT8 PyTorch model loaded: {Q8_PATH}")
    else:
        raise RuntimeError(
            "No model found. Run: python training/train_and_export.py"
        )

    # MinIO client
    _mc = Minio(MINIO_ENDPOINT, access_key=MINIO_ACCESS_KEY,
                secret_key=MINIO_SECRET_KEY, secure=False)
    _ensure_bucket()

    # DB pool
    if DATABASE_URL:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)

    yield

    if _pool:
        await _pool.close()


def _load_torch_q8(path: pathlib.Path) -> nn.Module:
    model = models.efficientnet_b0(weights=None)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features,
                                     _meta.get("num_classes", 5))
    model_q8 = torch.quantization.quantize_dynamic(
        model, {nn.Linear, nn.Conv2d}, dtype=torch.qint8
    )
    model_q8.load_state_dict(
        torch.load(str(path), map_location="cpu"), strict=False
    )
    model_q8.eval()
    return model_q8


def _ensure_bucket():
    try:
        if not _mc.bucket_exists(MINIO_BUCKET):
            _mc.make_bucket(MINIO_BUCKET)
    except Exception as e:
        print(f"⚠️  MinIO bucket check failed: {e}")


app = FastAPI(title="DL Image Service", lifespan=lifespan)


# ── Inference helpers ─────────────────────────────────────────────────────────
def preprocess_image(img_bytes: bytes) -> tuple[np.ndarray, torch.Tensor]:
    img   = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    tensor = _preprocess(img)              # (3, 224, 224)
    arr    = tensor.unsqueeze(0).numpy()   # (1, 3, 224, 224) float32
    return arr, tensor.unsqueeze(0)


def run_onnx_inference(arr: np.ndarray) -> np.ndarray:
    logits = _ort_sess.run(None, {"image": arr})[0]   # (1, 5)
    return logits


def run_torch_inference(tensor: torch.Tensor) -> np.ndarray:
    with torch.no_grad():
        logits = _torch_model(tensor).numpy()
    return logits


def softmax(logits: np.ndarray) -> np.ndarray:
    e = np.exp(logits - logits.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


# ── Grad-CAM ─────────────────────────────────────────────────────────────────
class GradCAMHook:
    """
    Hooks into the last conv block of EfficientNet-B0 to extract
    Grad-CAM activation maps.
    Requires the non-quantized ONNX model — works with PyTorch model only.
    """
    def __init__(self, model: nn.Module):
        self.gradients   = None
        self.activations = None
        target_layer = model.features[-1]
        target_layer.register_forward_hook(self._save_activations)
        target_layer.register_full_backward_hook(self._save_gradients)

    def _save_activations(self, module, input, output):
        self.activations = output.detach()

    def _save_gradients(self, module, grad_input, grad_output):
        self.gradients = grad_output[0].detach()

    def compute(self, logits: torch.Tensor, class_idx: int,
                orig_size: tuple[int, int]) -> np.ndarray:
        """Returns Grad-CAM heatmap resized to orig_size as uint8 numpy array."""
        logits[0, class_idx].backward()
        weights = self.gradients.mean(dim=(2, 3), keepdim=True)   # (1, C, 1, 1)
        cam     = (weights * self.activations).sum(dim=1).squeeze(0)  # (H, W)
        cam     = torch.relu(cam).numpy()
        cam     = (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)
        cam_pil = Image.fromarray((cam * 255).astype(np.uint8)).resize(
            orig_size, Image.BILINEAR
        )
        return np.array(cam_pil)


def generate_gradcam(img_bytes: bytes, pred_class: int) -> Optional[bytes]:
    """
    Generates Grad-CAM heatmap and overlays it on the original image.
    Returns PNG bytes or None if Grad-CAM is not available (ONNX mode).
    """
    try:
        import torchvision.transforms.functional as TF
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        tensor = _preprocess(img).unsqueeze(0).requires_grad_(True)

        # Use a fresh non-quantized model for Grad-CAM (quantized can't backprop)
        gcam_model = models.efficientnet_b0(weights=None)
        gcam_model.classifier[1] = nn.Linear(
            gcam_model.classifier[1].in_features, _meta.get("num_classes", 5)
        )
        if Q8_PATH.exists():
            gcam_model.load_state_dict(
                torch.load(str(Q8_PATH), map_location="cpu"), strict=False
            )
        gcam_model.eval()

        hook    = GradCAMHook(gcam_model)
        logits  = gcam_model(tensor)
        cam_arr = hook.compute(logits, pred_class, img.size)

        # Colorize heatmap (hot colormap)
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.cm as cm

        colormap  = cm.get_cmap("hot")
        cam_color = (colormap(cam_arr / 255.0)[:, :, :3] * 255).astype(np.uint8)
        cam_pil   = Image.fromarray(cam_color).resize(img.size, Image.BILINEAR)

        # Overlay: 60% original + 40% heatmap
        overlay = Image.blend(img.convert("RGBA"),
                              cam_pil.convert("RGBA"), alpha=0.4)
        out = io.BytesIO()
        overlay.convert("RGB").save(out, format="PNG")
        return out.getvalue()
    except Exception as e:
        print(f"⚠️  Grad-CAM failed: {e}")
        return None


def upload_to_minio(key: str, data: bytes, content_type: str = "image/png") -> str:
    """Uploads bytes to MinIO and returns presigned URL valid for 1 hour."""
    _mc.put_object(
        MINIO_BUCKET, key,
        io.BytesIO(data), length=len(data),
        content_type=content_type,
    )
    url = _mc.presigned_get_object(MINIO_BUCKET, key,
                                   expires=PRESIGN_EXPIRY)
    return url


async def fetch_patient_image(patient_id: str) -> Optional[bytes]:
    """Fetches the most recent image for a patient from MinIO via DB."""
    if not _pool:
        return None
    async with _pool.acquire() as conn:
        aes_key = os.getenv("AES_KEY", "changeme_32_char_key_here______")
        row = await conn.fetchrow(
            """SELECT pgp_sym_decrypt(minio_key, $2) AS plain_key
               FROM images
               WHERE patient_id = $1::uuid AND deleted_at IS NULL
               ORDER BY created_at DESC LIMIT 1""",
            patient_id, aes_key,
        )
    if not row:
        return None
    key  = row["plain_key"]
    data = io.BytesIO()
    _mc.get_object(MINIO_BUCKET, key).readinto(data)
    return data.getvalue()


# ── Endpoints ─────────────────────────────────────────────────────────────────
class PredictByPatientRequest(BaseModel):
    patient_id: str


@app.post("/dl/predict")
async def predict(
    patient_id: Optional[str] = None,
    file: Optional[UploadFile] = File(default=None),
):
    """
    Accepts:
      - multipart/form-data with image file (file=)
      - JSON body with {"patient_id": "..."}  (fetches image from MinIO)
    """
    t0 = time.perf_counter()

    # 1. Get image bytes
    if file is not None:
        img_bytes = await file.read()
    elif patient_id:
        img_bytes = await fetch_patient_image(patient_id)
        if not img_bytes:
            raise HTTPException(
                404,
                f"No image found for patient {patient_id}. "
                "Upload an image first via POST /fhir/Media"
            )
    else:
        raise HTTPException(400, "Provide either file or patient_id")

    # 2. Preprocess
    arr, tensor = preprocess_image(img_bytes)
    orig_img    = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    orig_size   = orig_img.size

    # 3. Inference
    if _use_onnx:
        logits = run_onnx_inference(arr)
    else:
        logits = run_torch_inference(tensor)

    probs     = softmax(logits)[0]          # (5,)
    pred_cls  = int(probs.argmax())
    risk_cat  = _meta.get("risk_map", {str(i): "UNKNOWN"
                            for i in range(5)}).get(str(pred_cls),
                            _meta.get("risk_map", {}).get(pred_cls, "UNKNOWN"))

    class_names = _meta.get("class_names",
                             ["No DR","Mild","Moderate","Severe","Proliferative DR"])

    # 4. Grad-CAM
    ts  = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    pid = patient_id or "upload"
    gradcam_url = None

    cam_bytes = generate_gradcam(img_bytes, pred_cls)
    if cam_bytes:
        cam_key = f"gradcam/{pid}_{ts}.png"
        gradcam_url = upload_to_minio(cam_key, cam_bytes)

    elapsed = (time.perf_counter() - t0) * 1000
    if elapsed > 15000:
        print(f"⚠️  DL inference took {elapsed:.0f}ms — exceeds 15s target")

    # 5. Build FHIR DiagnosticReport
    snomed_map = {
        "LOW":      "193349004",   # Diabetic retinopathy absent
        "MEDIUM":   "193350004",   # Mild diabetic retinopathy
        "HIGH":     "193351000",   # Severe diabetic retinopathy
        "CRITICAL": "59276001",    # Proliferative diabetic retinopathy
    }
    diagnostic_report = {
        "resourceType":   "DiagnosticReport",
        "status":         "final",
        "subject":        {"reference": f"Patient/{patient_id}"} if patient_id else None,
        "conclusion":     class_names[pred_cls],
        "conclusionCode": [{
            "coding": [{
                "system":  "http://snomed.info/sct",
                "code":    snomed_map.get(risk_cat, "193349004"),
                "display": class_names[pred_cls],
            }]
        }],
        "imagingStudy":   [{"display": f"Retinal fundus image — {pid}"}],
        "media":          [{"link": {"url": gradcam_url}}] if gradcam_url else [],
    }

    return {
        "patient_id":        patient_id,
        "predicted_class":   pred_cls,
        "class_name":        class_names[pred_cls],
        "probabilities":     {class_names[i]: round(float(p), 4)
                              for i, p in enumerate(probs)},
        "risk_score":        round(float(probs[pred_cls]), 4),
        "risk_category":     risk_cat,
        "is_critical":       risk_cat == "CRITICAL",
        "gradcam_url":       gradcam_url,
        "fhir_diagnostic":   diagnostic_report,
        "model":             "EfficientNet-B0 ONNX" if _use_onnx else "EfficientNet-B0 INT8",
        "elapsed_ms":        round(elapsed, 1),
        "disclaimer":        (
            "Resultado generado por IA de apoyo diagnóstico. "
            "No reemplaza criterio médico. Sujeto a revisión clínica."
        ),
    }


class FeedbackRequest(BaseModel):
    risk_report_id: str
    feedback:       str
    notes:          Optional[str] = None


@app.post("/dl/feedback", status_code=201)
async def save_feedback(body: FeedbackRequest):
    if not _pool:
        raise HTTPException(500, "DB not available")
    async with _pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO model_feedback (risk_report_id, feedback, notes)
               VALUES ($1::uuid, $2, $3)
               ON CONFLICT DO NOTHING""",
            body.risk_report_id, body.feedback, body.notes,
        )
    return {"status": "saved"}


@app.get("/dl/version")
async def version():
    return {
        "model":       "EfficientNet-B0",
        "format":      "ONNX CPUExecutionProvider" if _use_onnx else "INT8 PyTorch",
        "dataset":     _meta.get("dataset", "APTOS 2019"),
        "num_classes": _meta.get("num_classes", 5),
        "class_names": _meta.get("class_names", []),
        "risk_map":    _meta.get("risk_map", {}),
        "best_val_f1": _meta.get("best_val_f1", "N/A"),
        "clinical_note": _meta.get("clinical_note", ""),
    }


@app.get("/health")
async def health():
    return {
        "status":       "ok",
        "service":      "dl-service",
        "model_loaded": _ort_sess is not None or _torch_model is not None,
        "backend":      "ONNX" if _use_onnx else "INT8-PyTorch",
    }