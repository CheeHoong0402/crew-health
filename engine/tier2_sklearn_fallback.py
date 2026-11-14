"""
Tier 2 fallback: tuned scikit-learn HistGradientBoosting model (artifacts/tier2_hgb_tuned.joblib).

Drop-in replacement for Tier2RiskEngine when LightGBM / onnxmltools / SHAP are unavailable
(e.g. air-gapped edge box). Same predict() contract. Explanations use batched counterfactual
ablation (one predict_proba call for all features) - same method as the ONNX fallback explainer.
Train/refresh with scripts/tune_eval.py.
"""
from __future__ import annotations
import time
from pathlib import Path
import joblib
import numpy as np
from engine.tier1_hbm_physics import HBMState, TelemetryInput
from engine.tier2_risk_engine import (ALERT_LABELS, FEATURE_COLUMNS, NOMINAL_BASELINE, Tier2Prediction,
                                      extract_feature_vector)

DEFAULT_JOBLIB = Path(__file__).resolve().parent.parent / "artifacts" / "tier2_hgb_tuned.joblib"


class Tier2SklearnEngine:
    def __init__(self, path: Path = DEFAULT_JOBLIB) -> None:
        if not path.exists():
            raise FileNotFoundError(f"Missing {path}. Run scripts/tune_eval.py first.")
        self.model = joblib.load(path)["model"]
        self._base = np.asarray([NOMINAL_BASELINE[c] for c in FEATURE_COLUMNS], dtype=np.float32)

    def predict(self, t: TelemetryInput, hbm: HBMState | None = None) -> Tier2Prediction:
        t0 = time.perf_counter()
        v = extract_feature_vector(t, hbm)
        p = self.model.predict_proba(v)[0]
        n = len(self._base)
        risk = lambda q: q[..., 1] + 2.0 * q[..., 2]
        V = np.repeat(v, n, axis=0)
        V[np.arange(n), np.arange(n)] = self._base
        moved = np.abs(v[0] - self._base) >= 1e-4
        d = np.where(moved, np.maximum(0.0, float(risk(p)) - risk(self.model.predict_proba(V))), 0.0)
        if d.sum() <= 1e-6:
            d = np.abs(v[0] - self._base) / np.maximum(1.0, np.abs(self._base))
        w = d / (d.sum() or 1.0)
        top = [{"feature": FEATURE_COLUMNS[int(i)], "value": round(float(v[0, int(i)]), 2),
                "impact_weight": round(float(w[int(i)]), 3)} for i in np.argsort(-w)[:3]]
        idx = int(np.argmax(p))
        return Tier2Prediction(ALERT_LABELS[idx],
                               {k: round(float(p[j]), 4) for j, k in enumerate(ALERT_LABELS)},
                               top, round((time.perf_counter() - t0) * 1000.0, 3), "sklearn_hgb_counterfactual")
