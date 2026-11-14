"""
Tier 3 — Deterministic NASA-STD-3001 Safety Interlock (Symbolic Guardrail).

Hard-coded clinical and life-support rule engine executing in < 5 ms.
Cannot be overridden by ML predictions.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from engine.tier1_hbm_physics import HBMState, TelemetryInput


@dataclass
class SafetyInterlockResult:
    alert_level: str  # NOMINAL_GREEN | CAUTION_AMBER | CRITICAL_RED
    time_to_criticality_minutes: Optional[int]
    triggered_protocol_ids: List[str] = field(default_factory=list)
    detected_syndromes: List[str] = field(default_factory=list)
    deterministic_reasons: List[Tuple[str, float, float]] = field(default_factory=list)
    execution_ms: float = 0.0


def evaluate_safety_interlock(t: TelemetryInput, hbm: HBMState) -> SafetyInterlockResult:
    t0 = time.perf_counter()

    red_hits = 0
    amber_hits = 0
    ttcs: List[int] = []
    protocols: List[str] = []
    syndromes: List[str] = []
    reasons: List[Tuple[str, float, float]] = []

    def add_protocol(pid: str, syn: str) -> None:
        if pid not in protocols:
            protocols.append(pid)
        if syn not in syndromes:
            syndromes.append(syn)

    # 1. Closed-Habitat Toxicity / Lunar Dust (< 5 min critical)
    if (
        t.cabin_ppco2_mmhg > 3.0
        or t.cabin_o2_pct < 19.5
        or t.cabin_pressure_kpa < 96.0
        or t.airborne_dust_mg_m3 > 0.30
    ):
        red_hits += 1
        ttcs.append(4)
        add_protocol("PROTO-ECLSS-01", "CLOSED_HABITAT_HYPERCAPNIA_DUST_TOXICITY")
        if t.cabin_ppco2_mmhg > 3.0:
            reasons.append(("cabin_ppco2_mmhg", t.cabin_ppco2_mmhg, 0.72))
        if t.airborne_dust_mg_m3 > 0.30:
            reasons.append(("airborne_dust_mg_m3", t.airborne_dust_mg_m3, 0.58))
        if t.cabin_o2_pct < 19.5:
            reasons.append(("cabin_o2_pct", t.cabin_o2_pct, 0.69))

    # 2. Acute Solar Particle Event (SPE) / Prodromal ARS (15-45 min window)
    if (
        t.goes_proton_flux_pfu > 10.0
        or t.dosimeter_rate_usv_hr > 100.0
        or (
            t.goes_proton_flux_pfu > 5.0
            and t.core_temp_c > 38.0
            and t.hr_baseline_7d_delta_pct >= 20.0
        )
    ):
        red_hits += 1
        ttc_spe = 18 if t.goes_proton_flux_pfu >= 25.0 else 30
        ttcs.append(ttc_spe)
        add_protocol("PROTO-SPE-01", "ACUTE_SPE_RADIATION_STORM")
        reasons.append(("goes_proton_flux_pfu", t.goes_proton_flux_pfu, 0.61))
        if t.dosimeter_rate_usv_hr > 100.0:
            reasons.append(("dosimeter_rate_usv_hr", t.dosimeter_rate_usv_hr, 0.48))

    # 3. Severe Spacesuit Impact / Clavicle Fracture & DCS Risk (Immediate)
    if (
        t.suit_pressure_psi < 3.9
        or t.ltv_imu_peak_g > 2.5
        or hbm.clavicle_impact_stress_pct > 80.0
        or (
            t.ltv_imu_peak_g > 2.0
            and hbm.effective_hut_shoulder_clearance_mm < 12.0
            and hbm.bone_mass_retention_pct < 92.0
        )
    ):
        red_hits += 1
        ttcs.append(5)
        add_protocol("PROTO-SUIT-01", "ELEVATED_HBM_CLAVICLE_IMPACT_RISK")
        reasons.append(("ltv_imu_peak_g", t.ltv_imu_peak_g, 0.44))
        reasons.append(("suit_shoulder_clearance_mm", hbm.effective_hut_shoulder_clearance_mm, 0.25))
        reasons.append(("hbm_bone_mass_retention_pct", hbm.bone_mass_retention_pct, 0.24))

    # 4. Cardiovascular / Orthostatic Fluid Shift Crisis (< 10 min)
    if (
        t.systolic_bp_mmhg < 90.0
        or t.diastolic_bp_mmhg < 60.0
        or t.systolic_bp_mmhg > 160.0
        or t.diastolic_bp_mmhg > 100.0
        or t.resting_hr_bpm > 120.0
        or (t.mass_change_48h_kg <= -1.5 and t.systolic_bp_mmhg < 95.0 and t.resting_hr_bpm > 105.0)
    ):
        red_hits += 1
        ttcs.append(8)
        add_protocol("PROTO-CV-01", "CARDIOVASCULAR_FLUID_SHIFT_CRISIS")
        reasons.append(("systolic_bp_mmhg", t.systolic_bp_mmhg, 0.52))
        reasons.append(("resting_hr_bpm", t.resting_hr_bpm, 0.37))

    # 5. Acute Metabolic or Infectious Crisis (< 15 min)
    if t.blood_glucose_mg_dl < 70.0 or t.blood_glucose_mg_dl > 250.0 or t.core_temp_c > 38.5:
        red_hits += 1
        ttcs.append(12)
        add_protocol("PROTO-MET-01", "ACUTE_METABOLIC_OR_INFECTIOUS_CRISIS")
        if t.blood_glucose_mg_dl < 70.0 or t.blood_glucose_mg_dl > 250.0:
            reasons.append(("blood_glucose_mg_dl", t.blood_glucose_mg_dl, 0.55))
        if t.core_temp_c > 38.5:
            reasons.append(("core_temp_c", t.core_temp_c, 0.51))

    # --- AMBER WARNING CONDITIONS ---
    # 6. Spaceflight-Associated Neuro-ocular Syndrome (SANS)
    if (
        t.cabin_ppco2_mmhg > 2.5
        and t.diastolic_bp_mmhg >= 84.0
        and t.mission_elapsed_days > 60.0
    ):
        amber_hits += 1
        ttcs.append(720)
        add_protocol("PROTO-SANS-01", "SPACEFLIGHT_NEURO_OCULAR_SYNDROME_SANS")
        reasons.append(("cabin_ppco2_mmhg", t.cabin_ppco2_mmhg, 0.34))
        reasons.append(("mission_elapsed_days", t.mission_elapsed_days, 0.28))

    # 7. Career / Organ Radiation Limit Approach (> 85% of 600 mSv)
    if hbm.career_dose_limit_pct > 85.0 or t.radin2_daily_usv > 1200.0:
        amber_hits += 1
        ttcs.append(1440)
        add_protocol("PROTO-RAD-02", "CAREER_ORGAN_RADIATION_APPROACH")
        reasons.append(("career_dose_limit_pct", hbm.career_dose_limit_pct, 0.42))

    # 8. Accelerated Bone & Muscle Decay
    if hbm.monthly_bone_loss_rate > 0.015 or t.ared_compliance_14d < 0.80 or hbm.bone_mass_retention_pct < 92.5:
        amber_hits += 1
        ttcs.append(10080)
        add_protocol("PROTO-BONE-02", "ACCELERATED_BONE_MUSCLE_DECAY")
        reasons.append(("ared_compliance_14d", t.ared_compliance_14d, 0.31))
        reasons.append(("hbm_bone_mass_retention_pct", hbm.bone_mass_retention_pct, 0.29))

    # 9. Severe Sleep, Mood & Hypercapnic Cognitive Burnout
    if (
        t.sleep_hours_3d_avg < 5.5
        or t.mood_score_1_10 <= 3.0
        or (t.cabin_ppco2_mmhg > 2.3 and t.sleep_hours_3d_avg < 6.0 and t.mood_score_1_10 <= 4.5)
    ):
        amber_hits += 1
        ttcs.append(1440)
        add_protocol("PROTO-MIND-01", "HYPERCAPNIC_COGNITIVE_BURNOUT")
        reasons.append(("sleep_hours_3d_avg", t.sleep_hours_3d_avg, 0.36))
        reasons.append(("mood_score_1_10", t.mood_score_1_10, 0.27))

    # Borderline metabolic / temp / HR AMBER catches
    if (
        (70.0 <= t.blood_glucose_mg_dl < 78.0)
        or (200.0 <= t.blood_glucose_mg_dl <= 250.0)
        or (37.6 <= t.core_temp_c <= 38.5)
        or (100.0 <= t.resting_hr_bpm <= 120.0)
    ):
        amber_hits += 1
        ttcs.append(60)
        if not protocols:
            add_protocol("PROTO-MET-01", "BORDERLINE_METABOLIC_THERMAL_STRESS")
        reasons.append(("core_temp_c", t.core_temp_c, 0.26))

    if red_hits > 0:
        level = "CRITICAL_RED"
    elif amber_hits > 0:
        level = "CAUTION_AMBER"
    else:
        level = "NOMINAL_GREEN"
        add_protocol("PROTO-NOM-01", "NOMINAL_MICROGRAVITY_ADAPTATION")

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return SafetyInterlockResult(
        alert_level=level,
        time_to_criticality_minutes=min(ttcs) if ttcs else None,
        triggered_protocol_ids=protocols,
        detected_syndromes=syndromes,
        deterministic_reasons=reasons,
        execution_ms=round(elapsed_ms, 3),
    )
