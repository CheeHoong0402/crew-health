"""
Tier 2 (temporal) — early-warning model over rolling windows, per architecture plan Sec.1 (24h/7d/30d windows).

Predicts P(Tier-3 interlock leaves GREEN within the next 48 h) from the last 8 daily telemetry snapshots.
Labels are FUTURE events, not the current-snapshot rules, so this model carries information the interlock does not.
Trained by scripts/train_temporal_tier2.py on synthetic physiology timelines (real OSDR/flight data pending).
Advisory only: it can raise an early warning, it can never lower an interlock alert.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import List, Sequence
import numpy as np

from engine.tier1_hbm_physics import TelemetryInput

KEY_FIELDS = ("resting_hr_bpm", "systolic_bp_mmhg", "diastolic_bp_mmhg", "hrv_rmssd_ms", "blood_glucose_mg_dl",
              "core_temp_c", "mass_change_48h_kg", "sleep_hours_3d_avg", "mood_score_1_10", "cabin_ppco2_mmhg",
              "goes_proton_flux_pfu", "airborne_dust_mg_m3", "ared_compliance_14d", "cumulative_career_msv",
              "cabin_o2_pct", "cabin_pressure_kpa", "dosimeter_rate_usv_hr")
WINDOW = 8  # current day + 7 previous
FEATURE_NAMES = tuple(f"{f}__{k}" for f in KEY_FIELDS for k in ("cur", "d1", "vs7mean", "slope7", "slope3", "proj2"))
ARTIFACT = Path(__file__).resolve().parent.parent / "artifacts" / "tier2_temporal.joblib"
_X = np.arange(WINDOW, dtype=np.float64) - (WINDOW - 1) / 2.0
_X3 = np.array([-1.0, 0.0, 1.0])


def window_features(history: Sequence[TelemetryInput]) -> np.ndarray:
    """history: chronological list, newest last, len >= 8 (older entries ignored). Returns shape (1, 6*len(KEY_FIELDS))."""
    h = list(history)[-WINDOW:]
    if len(h) < WINDOW:
        h = [h[0]] * (WINDOW - len(h)) + h
    out = []
    for f in KEY_FIELDS:
        s = np.array([float(getattr(t, f)) for t in h], dtype=np.float64)
        s3 = s[-3:]; sl3 = float((_X3 * (s3 - s3.mean())).sum() / 2.0)
        out += [s[-1], s[-1] - s[-2], s[-1] - s[:-1].mean(), float((_X * (s - s.mean())).sum() / (_X ** 2).sum()), sl3, s[-1] + 2.0 * sl3]
    return np.asarray([out], dtype=np.float32)


@dataclass
class EarlyWarning:
    probability: float
    triggered: bool
    threshold: float
    top_trends: List[dict]
    inference_ms: float


class TemporalEarlyWarning:
    def __init__(self, path: Path = ARTIFACT) -> None:
        import joblib
        d = joblib.load(path)
        self.model, self.threshold, self.names = d["model"], float(d["threshold"]), d["feature_names"]
        self._ref = d.get("ref_mean"), d.get("ref_std")

    def predict(self, history: Sequence[TelemetryInput]) -> EarlyWarning:
        import time
        t0 = time.perf_counter()
        x = window_features(history)
        p = float(self.model.predict_proba(x)[0, 1])
        mean, std = self._ref
        top = []
        if mean is not None:  # most-deviating trend features vs population (simple, fast explanation)
            z = (x[0] - mean) / np.maximum(std, 1e-6)
            for i in np.argsort(-np.abs(z))[:3]:
                top.append({"feature": self.names[int(i)], "value": round(float(x[0, int(i)]), 3), "z": round(float(z[int(i)]), 2)})
        return EarlyWarning(round(p, 4), p >= self.threshold, round(self.threshold, 4), top, round((time.perf_counter() - t0) * 1e3, 3))
