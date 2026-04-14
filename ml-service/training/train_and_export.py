"""
ml-service/training/train_and_export.py
Run ONCE locally (before docker build) to train + export ml_model.onnx.
"""

import json, pathlib, warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import train_test_split
from sklearn.metrics import f1_score, roc_auc_score, precision_score, recall_score
from xgboost import XGBClassifier
import shap
import mlflow
import mlflow.sklearn

# ONNX
from onnxmltools import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType
import onnxruntime as ort


# ─────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────
MODELS_DIR   = pathlib.Path(__file__).parent.parent / "models"
DATASET_PATH = pathlib.Path(__file__).parent.parent.parent / "datasets" / "diabetes.csv"
MODELS_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────
FEATURE_COLS = [
    "Pregnancies", "Glucose", "BloodPressure", "SkinThickness",
    "Insulin", "BMI", "DiabetesPedigreeFunction", "Age"
]
TARGET_COL = "Outcome"

LOINC_MAP = {
    "Glucose": "2339-0",
    "BloodPressure": "55284-4",
    "BMI": "39156-5",
    "Insulin": "14749-6",
    "Age": "21612-7",
    "Pregnancies": "11996-6",
    "SkinThickness": "39106-0",
    "DiabetesPedigreeFunction": "33914-3",
}


# ─────────────────────────────────────────────────────────────
# Load data
# ─────────────────────────────────────────────────────────────
def load_data():
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Dataset not found at {DATASET_PATH}")

    df = pd.read_csv(DATASET_PATH)

    # imputación clínica
    for col in ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]:
        df[col] = df[col].replace(0, df[col].median())

    X = df[FEATURE_COLS].values.astype("float32")
    y = df[TARGET_COL].values
    return X, y, df


# ─────────────────────────────────────────────────────────────
# Train
# ─────────────────────────────────────────────────────────────
def train(X, y):
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    base = XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        tree_method="hist",
        eval_metric="logloss",
        random_state=42,
        use_label_encoder=False,
    )

    # 🔥 ENTRENAR BASE (clave para ONNX)
    base.fit(X_train, y_train)

    # calibración
    model = CalibratedClassifierCV(base, method="isotonic", cv=5)
    model.fit(X_train, y_train)

    # métricas
    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    metrics = {
        "f1": round(float(f1_score(y_test, y_pred)), 4),
        "auc_roc": round(float(roc_auc_score(y_test, y_proba)), 4),
        "precision": round(float(precision_score(y_test, y_pred)), 4),
        "recall": round(float(recall_score(y_test, y_pred)), 4),
        "n_train": len(X_train),
        "n_test": len(X_test),
    }

    print("Metrics:", metrics)

    # SHAP (modelo interno entrenado)
    explainer = shap.TreeExplainer(
        model.calibrated_classifiers_[0].estimator
    )
    shap_sample = X_train[:100]

    return model, base, explainer, metrics, shap_sample, X_test, y_test


# ─────────────────────────────────────────────────────────────
# Export ONNX
# ─────────────────────────────────────────────────────────────
def export_onnx(base_model, n_features: int):
    initial_type = [("float_input", FloatTensorType([None, n_features]))]

    onnx_model = convert_xgboost(
        base_model,
        initial_types=initial_type
    )

    out_path = MODELS_DIR / "ml_model.onnx"

    with open(out_path, "wb") as f:
        f.write(onnx_model.SerializeToString())

    print("Model exported:", out_path)

    # test ONNX
    sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
    dummy = np.zeros((2, n_features), dtype="float32")
    out = sess.run(None, {"float_input": dummy})

    print("ONNX test OK")

    return str(out_path)

# ─────────────────────────────────────────────────────────────
# Save metadata
# ─────────────────────────────────────────────────────────────
def save_metadata(metrics: dict, shap_sample, feature_cols: list):
    meta = {
        "feature_cols": feature_cols,
        "loinc_map": LOINC_MAP,
        "metrics": metrics,
        "thresholds": {
            "LOW": [0.0, 0.30],
            "MEDIUM": [0.30, 0.60],
            "HIGH": [0.60, 0.85],
            "CRITICAL": [0.85, 1.0],
        },
    }

    meta_path = MODELS_DIR / "ml_metadata.json"

    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print("Metadata saved:", meta_path)

    metrics_path = pathlib.Path(__file__).parent / "metrics.json"

    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)


# ─────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Loading dataset...")
    X, y, df = load_data()

    print("Training model...")
    with mlflow.start_run(run_name="xgboost_calibrated_pima"):
        model, base, explainer, metrics, shap_sample, X_test, y_test = train(X, y)
        mlflow.log_metrics(metrics)
        mlflow.sklearn.log_model(model, "calibrated_xgboost")

    print("Exporting to ONNX...")
    export_onnx(base, n_features=len(FEATURE_COLS))  # 🔥 FIX

    print("Saving metadata...")
    save_metadata(metrics, shap_sample, FEATURE_COLS)

    print("Done!")
    print(f"F1={metrics['f1']}  AUC-ROC={metrics['auc_roc']}")