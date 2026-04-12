"""
ml-service/training/train_and_export.py
Run ONCE locally (before docker build) to train + export ml_model.onnx.

Usage:
    pip install xgboost scikit-learn skl2onnx onnxruntime shap pandas numpy mlflow
    python training/train_and_export.py

Output:
    models/ml_model.onnx  ← loaded by the FastAPI service
    training/metrics.json ← F1, AUC-ROC, Precision, Recall for README
"""
import json, pathlib, warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import f1_score, roc_auc_score, precision_score, recall_score
from xgboost import XGBClassifier
import shap
import mlflow
import mlflow.sklearn

# ── skl2onnx ─────────────────────────────────────────────────────────────────
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
import onnxruntime as ort

MODELS_DIR   = pathlib.Path(__file__).parent.parent / "models"
DATASET_PATH = pathlib.Path(__file__).parent.parent.parent / "datasets" / "diabetes.csv"
MODELS_DIR.mkdir(exist_ok=True)

# LOINC feature mapping (must match seed_patients.py)
FEATURE_COLS = ["Pregnancies", "Glucose", "BloodPressure", "SkinThickness",
                "Insulin", "BMI", "DiabetesPedigreeFunction", "Age"]
TARGET_COL   = "Outcome"

LOINC_MAP = {
    "Glucose":                  "2339-0",
    "BloodPressure":            "55284-4",
    "BMI":                      "39156-5",
    "Insulin":                  "14749-6",
    "Age":                      "21612-7",
    "Pregnancies":              "11996-6",
    "SkinThickness":            "39106-0",
    "DiabetesPedigreeFunction": "33914-3",
}


def load_data():
    if not DATASET_PATH.exists():
        raise FileNotFoundError(
            f"Dataset not found at {DATASET_PATH}\n"
            "Download PIMA Diabetes from:\n"
            "  https://www.kaggle.com/datasets/uciml/pima-indians-diabetes-database\n"
            "Place it at: datasets/diabetes.csv"
        )
    df = pd.read_csv(DATASET_PATH)
    # Replace zeros in medical columns with median (clinical imputation)
    for col in ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]:
        df[col] = df[col].replace(0, df[col].median())
    X = df[FEATURE_COLS].values.astype("float32")
    y = df[TARGET_COL].values
    return X, y, df


def train(X, y):
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    base = XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        tree_method="hist",          # CPU-only
        eval_metric="logloss",
        random_state=42,
        use_label_encoder=False,
    )
    # Isotonic calibration — probabilities are clinically reliable
    model = CalibratedClassifierCV(base, method="isotonic", cv=5)
    model.fit(X_train, y_train)

    # Metrics
    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]
    metrics = {
        "f1":        round(float(f1_score(y_test, y_pred)), 4),
        "auc_roc":   round(float(roc_auc_score(y_test, y_proba)), 4),
        "precision": round(float(precision_score(y_test, y_pred)), 4),
        "recall":    round(float(recall_score(y_test, y_pred)), 4),
        "n_train":   len(X_train),
        "n_test":    len(X_test),
    }
    print(f"✅ Metrics: {metrics}")

    # SHAP background (small sample for speed)
    explainer   = shap.TreeExplainer(base)
    shap_sample = X_train[:100]

    return model, explainer, metrics, shap_sample, X_test, y_test


def export_onnx(model, n_features: int):
    initial_type = [("float_input", FloatTensorType([None, n_features]))]
    onnx_model   = convert_sklearn(model, initial_types=initial_type,
                                   target_opset=17)
    out_path = MODELS_DIR / "ml_model.onnx"
    with open(out_path, "wb") as f:
        f.write(onnx_model.SerializeToString())
    print(f"✅ Model exported → {out_path}")

    # Smoke-test: run inference on 2 rows
    sess  = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
    dummy = np.zeros((2, n_features), dtype="float32")
    out   = sess.run(None, {"float_input": dummy})
    print(f"   ONNX smoke-test OK — output shape: {out[1].shape}")
    return str(out_path)


def save_metadata(metrics: dict, shap_sample, feature_cols: list):
    meta = {
        "feature_cols": feature_cols,
        "loinc_map":    LOINC_MAP,
        "metrics":      metrics,
        "thresholds": {
            "LOW":      [0.0, 0.30],
            "MEDIUM":   [0.30, 0.60],
            "HIGH":     [0.60, 0.85],
            "CRITICAL": [0.85, 1.0],
        },
    }
    meta_path = MODELS_DIR / "ml_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"✅ Metadata saved → {meta_path}")

    metrics_path = pathlib.Path(__file__).parent / "metrics.json"
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)


if __name__ == "__main__":
    print("🔄 Loading dataset...")
    X, y, df = load_data()

    print("🔄 Training XGBoost (calibrated, isotonic, cv=5)...")
    with mlflow.start_run(run_name="xgboost_calibrated_pima"):
        model, explainer, metrics, shap_sample, X_test, y_test = train(X, y)
        mlflow.log_metrics(metrics)
        mlflow.sklearn.log_model(model, "calibrated_xgboost")

    print("🔄 Exporting to ONNX...")
    export_onnx(model, n_features=len(FEATURE_COLS))

    print("🔄 Saving metadata...")
    save_metadata(metrics, shap_sample, FEATURE_COLS)

    print("\n🎉 Done! Run: docker compose build ml-service")
    print(f"   F1={metrics['f1']}  AUC-ROC={metrics['auc_roc']}")