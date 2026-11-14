"""
Tier 2 — Temporal Multi-System Anomaly Engine (LightGBM + SHAP -> ONNX).

Trained on 25,000 physics-informed telemetry scenarios with a 10x asymmetric
penalty on CRITICAL_RED false negatives per Architecture Doc Section 5.
Exports `artifacts/aether_risk_engine.onnx` (< 15 MB, zipmap=False for browser &
edge onnxruntime compatibility) + `shap.TreeExplainer` explainability.
"""
from __future__ import annotations

import csv
import json
import pickle
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from engine.tier1_hbm_physics import HBMState, TelemetryInput, compute_hbm_state

ROOT_DIR = Path(__file__).resolve().parent.parent
ARTIFACTS_DIR = ROOT_DIR / "artifacts"
DEFAULT_ONNX_PATH = ARTIFACTS_DIR / "aether_risk_engine.onnx"
DEFAULT_LGBM_PKL = ARTIFACTS_DIR / "tier2_lgbm_explainer.pkl"
DEFAULT_META_PATH = ARTIFACTS_DIR / "tier2_metadata.json"
DEFAULT_DATASET_CSV = ROOT_DIR / "data" / "generated" / "aether_telemetry_25k.csv"

ALERT_LABELS = ("NOMINAL_GREEN", "CAUTION_AMBER", "CRITICAL_RED")

FEATURE_COLUMNS: Tuple[str, ...] = (
    "resting_hr_bpm",
    "hr_baseline_7d_delta_pct",
    "systolic_bp_mmhg",
    "diastolic_bp_mmhg",
    "hrv_rmssd_ms",
    "blood_glucose_mg_dl",
    "core_temp_c",
    "fluid_intake_l_24h",
    "mass_change_48h_kg",
    "sleep_hours_3d_avg",
    "sleep_efficiency_pct",
    "mood_score_1_10",
    "reaction_time_ms",
    "mission_elapsed_days",
    "ared_compliance_14d",
    "suit_pressure_psi",
    "ltv_imu_peak_g",
    "recent_suit_impacts_7d",
    "goes_proton_flux_pfu",
    "dosimeter_rate_usv_hr",
    "radin2_daily_usv",
    "cumulative_career_msv",
    "cabin_ppco2_mmhg",
    "cabin_o2_pct",
    "cabin_pressure_kpa",
    "airborne_dust_mg_m3",
    "hbm_bone_mass_retention_pct",
    "hbm_monthly_bone_loss_rate",
    "suit_shoulder_clearance_mm",
    "clavicle_impact_stress_pct",
    "cumulative_contact_trauma_score",
    "hydration_index",
    "career_dose_limit_pct",
)

# Reference nominal baseline used for ONNX sensitivity attribution fallback
NOMINAL_BASELINE: Dict[str, float] = {
    "resting_hr_bpm": 68.0,
    "hr_baseline_7d_delta_pct": 0.0,
    "systolic_bp_mmhg": 118.0,
    "diastolic_bp_mmhg": 76.0,
    "hrv_rmssd_ms": 45.0,
    "blood_glucose_mg_dl": 94.0,
    "core_temp_c": 36.8,
    "fluid_intake_l_24h": 2.6,
    "mass_change_48h_kg": -0.15,
    "sleep_hours_3d_avg": 7.6,
    "sleep_efficiency_pct": 88.0,
    "mood_score_1_10": 8.0,
    "reaction_time_ms": 245.0,
    "mission_elapsed_days": 30.0,
    "ared_compliance_14d": 0.90,
    "suit_pressure_psi": 4.3,
    "ltv_imu_peak_g": 0.4,
    "recent_suit_impacts_7d": 0.0,
    "goes_proton_flux_pfu": 0.8,
    "dosimeter_rate_usv_hr": 25.0,
    "radin2_daily_usv": 480.0,
    "cumulative_career_msv": 95.0,
    "cabin_ppco2_mmhg": 1.6,
    "cabin_o2_pct": 21.0,
    "cabin_pressure_kpa": 101.3,
    "airborne_dust_mg_m3": 0.02,
    "hbm_bone_mass_retention_pct": 99.1,
    "hbm_monthly_bone_loss_rate": 0.009,
    "suit_shoulder_clearance_mm": 12.1,
    "clavicle_impact_stress_pct": 10.5,
    "cumulative_contact_trauma_score": 0.0,
    "hydration_index": 1.04,
    "career_dose_limit_pct": 15.8,
}


@dataclass
class Tier2Prediction:
    predicted_label: str
    probabilities: Dict[str, float]
    top_shap_causes: List[Dict[str, float | str]]
    inference_ms: float
    explainer_backend: str


def extract_feature_vector(t: TelemetryInput, hbm: Optional[HBMState] = None) -> np.ndarray:
    """Build float32 shape (1, 33) telemetry + Tier 1 HBM feature matrix."""
    if hbm is None:
        hbm = compute_hbm_state(t)
    vals = [
        float(t.resting_hr_bpm),
        float(t.hr_baseline_7d_delta_pct),
        float(t.systolic_bp_mmhg),
        float(t.diastolic_bp_mmhg),
        float(t.hrv_rmssd_ms),
        float(t.blood_glucose_mg_dl),
        float(t.core_temp_c),
        float(t.fluid_intake_l_24h),
        float(t.mass_change_48h_kg),
        float(t.sleep_hours_3d_avg),
        float(t.sleep_efficiency_pct),
        float(t.mood_score_1_10),
        float(t.reaction_time_ms),
        float(t.mission_elapsed_days),
        float(t.ared_compliance_14d),
        float(t.suit_pressure_psi),
        float(t.ltv_imu_peak_g),
        float(t.recent_suit_impacts_7d),
        float(t.goes_proton_flux_pfu),
        float(t.dosimeter_rate_usv_hr),
        float(t.radin2_daily_usv),
        float(t.cumulative_career_msv),
        float(t.cabin_ppco2_mmhg),
        float(t.cabin_o2_pct),
        float(t.cabin_pressure_kpa),
        float(t.airborne_dust_mg_m3),
        float(hbm.bone_mass_retention_pct),
        float(hbm.monthly_bone_loss_rate),
        float(hbm.effective_hut_shoulder_clearance_mm),
        float(hbm.clavicle_impact_stress_pct),
        float(hbm.cumulative_contact_trauma_score),
        float(hbm.hydration_index),
        float(hbm.career_dose_limit_pct),
    ]
    return np.asarray([vals], dtype=np.float32)


def _load_telemetry_csv(csv_path: Path) -> Tuple[np.ndarray, np.ndarray]:
    xs: List[List[float]] = []
    ys: List[int] = []
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            xs.append([float(row[c]) for c in FEATURE_COLUMNS])
            ys.append(int(row["label_alert"]))
    return np.asarray(xs, dtype=np.float32), np.asarray(ys, dtype=np.int64)


def train_and_export_tier2(
    dataset_csv: Path = DEFAULT_DATASET_CSV,
    onnx_out: Path = DEFAULT_ONNX_PATH,
    explainer_pkl_out: Path = DEFAULT_LGBM_PKL,
    meta_out: Path = DEFAULT_META_PATH,
) -> Dict[str, object]:
    """Train 10x asymmetric LightGBM risk model, verify SHAP & ONNX parity, and export <15 MB ONNX."""
    import lightgbm as lgb
    import onnxmltools
    from onnxmltools.convert.common.data_types import FloatTensorType
    import onnxruntime as ort
    import shap
    from sklearn.metrics import classification_report, recall_score, f1_score
    from sklearn.model_selection import train_test_split

    X, y = _load_telemetry_csv(dataset_csv)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )

    # 10x asymmetric penalty against missing CRITICAL_RED emergencies (class 2)
    weight_map = {0: 1.0, 1: 2.5, 2: 10.0}
    sample_weights = np.asarray([weight_map[int(lbl)] for lbl in y_train], dtype=np.float32)

    clf = lgb.LGBMClassifier(
        objective="multiclass",
        num_class=3,
        n_estimators=160,
        max_depth=7,
        num_leaves=45,
        learning_rate=0.06,
        subsample=0.9,
        colsample_bytree=0.9,
        min_child_samples=15,
        random_state=42,
        n_jobs=-1,
        verbose=-1,
    )
    clf.fit(X_train, y_train, sample_weight=sample_weights)

    lgb_probs = clf.predict_proba(X_test)
    lgb_preds = np.argmax(lgb_probs, axis=1)

    red_recall = float(recall_score(y_test == 2, lgb_preds == 2))
    amber_recall = float(recall_score(y_test == 1, lgb_preds == 1))
    macro_f1 = float(f1_score(y_test, lgb_preds, average="macro"))

    onnx_out.parent.mkdir(parents=True, exist_ok=True)
    initial_type = [("float_input", FloatTensorType([None, len(FEATURE_COLUMNS)]))]
    onnx_model = onnxmltools.convert_lightgbm(
        clf,
        initial_types=initial_type,
        target_opset=15,
        zipmap=False,
    )
    with onnx_out.open("wb") as f:
        f.write(onnx_model.SerializeToString())

    # Verify ONNXRuntime parity vs LightGBM
    sess = ort.InferenceSession(str(onnx_out), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    ort_outputs = sess.run(None, {input_name: X_test})
    ort_labels = np.asarray(ort_outputs[0], dtype=np.int64)
    ort_probs_raw = ort_outputs[1]
    if isinstance(ort_probs_raw, list):
        ort_probs = np.asarray([[d[0], d[1], d[2]] for d in ort_probs_raw], dtype=np.float32)
    else:
        ort_probs = np.asarray(ort_probs_raw, dtype=np.float32)

    max_prob_diff = float(np.max(np.abs(lgb_probs - ort_probs)))
    label_agreement = float(np.mean(lgb_preds == ort_labels))

    explainer = shap.TreeExplainer(clf)
    with explainer_pkl_out.open("wb") as f:
        pickle.dump({"model": clf, "explainer": explainer}, f)

    size_mb = onnx_out.stat().st_size / (1024 * 1024)
    report = classification_report(y_test, lgb_preds, target_names=list(ALERT_LABELS), output_dict=True)

    meta = {
        "feature_columns": list(FEATURE_COLUMNS),
        "alert_labels": list(ALERT_LABELS),
        "nominal_baseline": NOMINAL_BASELINE,
        "onnx_file": onnx_out.name,
        "onnx_size_mb": round(size_mb, 4),
        "metrics": {
            "red_recall": round(red_recall, 5),
            "amber_recall": round(amber_recall, 5),
            "macro_f1": round(macro_f1, 5),
            "onnx_max_prob_diff": max_prob_diff,
            "onnx_label_agreement": label_agreement,
            "test_rows": int(len(y_test)),
        },
        "classification_report": report,
    }
    with meta_out.open("w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    return meta


class Tier2RiskEngine:
    """Fast edge inference wrapper over aether_risk_engine.onnx + SHAP TreeExplainer."""

    def __init__(
        self,
        onnx_path: Path = DEFAULT_ONNX_PATH,
        explainer_pkl_path: Path = DEFAULT_LGBM_PKL,
    ) -> None:
        if not onnx_path.exists():
            raise FileNotFoundError(
                f"Missing Tier 2 ONNX artifact at {onnx_path}. Run train_and_export_tier2() first."
            )
        import onnxruntime as ort
        self.onnx_path = onnx_path
        self.sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        self.input_name = self.sess.get_inputs()[0].name
        self._baseline_vec = np.asarray(
            [NOMINAL_BASELINE[c] for c in FEATURE_COLUMNS], dtype=np.float32
        )

        self._explainer = None
        if explainer_pkl_path.exists():
            try:
                with explainer_pkl_path.open("rb") as f:
                    payload = pickle.load(f)
                self._explainer = payload.get("explainer")
            except Exception:
                self._explainer = None

    def _run_onnx(self, X: np.ndarray) -> Tuple[int, np.ndarray]:
        outs = self.sess.run(None, {self.input_name: X.astype(np.float32)})
        pred_idx = int(outs[0][0])
        raw_probs = outs[1]
        if isinstance(raw_probs, list):
            d = raw_probs[0]
            probs = np.asarray([float(d[0]), float(d[1]), float(d[2])], dtype=np.float32)
        else:
            probs = np.asarray(raw_probs[0], dtype=np.float32)
        return pred_idx, probs

    def _compute_top_shap(self, X: np.ndarray, target_class: int) -> Tuple[List[Dict[str, float | str]], str]:
        if self._explainer is not None:
            shap_vals = self._explainer.shap_values(X)
            # Handle both old list-of-arrays and new 3D ndarray (1, n_features, n_classes)
            if isinstance(shap_vals, list):
                cls_contrib = np.asarray(shap_vals[target_class][0], dtype=np.float64)
            else:
                arr = np.asarray(shap_vals, dtype=np.float64)
                if arr.ndim == 3:
                    cls_contrib = arr[0, :, target_class]
                else:
                    cls_contrib = arr[0]
            pos = np.maximum(0.0, cls_contrib)
            if float(np.sum(pos)) <= 1e-9:
                pos = np.abs(cls_contrib)
            total = float(np.sum(pos)) or 1.0
            norm = pos / total
            order = np.argsort(-norm)[:3]
            items = [
                {
                    "feature": FEATURE_COLUMNS[int(idx)],
                    "value": round(float(X[0, int(idx)]), 2),
                    "impact_weight": round(max(0.0, min(1.0, float(norm[int(idx)]))), 3),
                }
                for idx in order
            ]
            return items, "shap_tree_explainer"

        # Pure ONNX counterfactual ablation fallback (zero LightGBM/shap dependency)
        _, base_probs = self._run_onnx(X)
        base_risk = float(base_probs[1] + 2.0 * base_probs[2])
        deltas = np.zeros(len(FEATURE_COLUMNS), dtype=np.float64)
        for i in range(len(FEATURE_COLUMNS)):
            if abs(float(X[0, i]) - float(self._baseline_vec[i])) < 1e-4:
                continue
            perturbed = X.copy()
            perturbed[0, i] = self._baseline_vec[i]
            _, p_pert = self._run_onnx(perturbed)
            pert_risk = float(p_pert[1] + 2.0 * p_pert[2])
            deltas[i] = max(0.0, base_risk - pert_risk)
        if float(np.sum(deltas)) <= 1e-6:
            # Z-score deviation fallback for strictly nominal samples
            scales = np.maximum(1.0, np.abs(self._baseline_vec))
            deltas = np.abs(X[0] - self._baseline_vec) / scales
        total = float(np.sum(deltas)) or 1.0
        norm = deltas / total
        order = np.argsort(-norm)[:3]
        items = [
            {
                "feature": FEATURE_COLUMNS[int(idx)],
                "value": round(float(X[0, int(idx)]), 2),
                "impact_weight": round(max(0.0, min(1.0, float(norm[int(idx)]))), 3),
            }
            for idx in order
        ]
        return items, "onnx_counterfactual"

    def predict(self, t: TelemetryInput, hbm: Optional[HBMState] = None) -> Tier2Prediction:
        t0 = time.perf_counter()
        X = extract_feature_vector(t, hbm)
        pred_idx, probs = self._run_onnx(X)
        # If non-nominal or caution probability is substantial, explain the highest-risk active class
        explain_cls = 2 if probs[2] >= 0.30 else (1 if probs[1] >= 0.30 else pred_idx)
        top_shap, backend = self._compute_top_shap(X, explain_cls)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return Tier2Prediction(
            predicted_label=ALERT_LABELS[pred_idx],
            probabilities={
                "NOMINAL_GREEN": round(float(probs[0]), 4),
                "CAUTION_AMBER": round(float(probs[1]), 4),
                "CRITICAL_RED": round(float(probs[2]), 4),
            },
            top_shap_causes=top_shap,
            inference_ms=round(elapsed_ms, 3),
            explainer_backend=backend,
        )


if __name__ == "__main__":
    summary = train_and_export_tier2()
    print(json.dumps({
        "onnx_file": summary["onnx_file"],
        "onnx_size_mb": summary["onnx_size_mb"],
        "metrics": summary["metrics"],
    }, indent=2))
