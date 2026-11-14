"""
Tier 1 — Physics-Informed Parametric Human Body Model (HBM) Digital Twin.

Computes deterministic biomechanical, musculoskeletal, radiation-organ, and
spacesuit clearance state variables per Section 2 of Project AETHER architecture.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict


@dataclass(frozen=True)
class TelemetryInput:
    # Physiological & Neurobehavioral Vitals
    resting_hr_bpm: float = 68.0
    hr_baseline_7d_delta_pct: float = 0.0
    systolic_bp_mmhg: float = 118.0
    diastolic_bp_mmhg: float = 76.0
    hrv_rmssd_ms: float = 42.0
    blood_glucose_mg_dl: float = 94.0
    core_temp_c: float = 36.8
    fluid_intake_l_24h: float = 2.6
    mass_change_48h_kg: float = -0.2
    sleep_hours_3d_avg: float = 7.6
    sleep_efficiency_pct: float = 88.0
    mood_score_1_10: float = 8.0
    reaction_time_ms: float = 245.0

    # Parametric HBM & Spacesuit Biomechanics
    mission_elapsed_days: float = 30.0
    baseline_bone_mass_kg: float = 3.10
    ared_compliance_14d: float = 0.90  # E_ARED in [0, 1]
    baseline_shoulder_clearance_mm: float = 18.0
    suit_pressure_psi: float = 4.3
    ltv_imu_peak_g: float = 0.4
    recent_suit_impacts_7d: int = 0

    # Space Radiation & Closed-Habitat ECLSS
    goes_proton_flux_pfu: float = 0.8
    goes_xray_flux_wm2: float = 1e-7
    dosimeter_rate_usv_hr: float = 25.0
    radin2_daily_usv: float = 480.0
    cumulative_career_msv: float = 95.0
    cabin_ppco2_mmhg: float = 1.6
    cabin_o2_pct: float = 21.0
    cabin_pressure_kpa: float = 101.3
    airborne_dust_mg_m3: float = 0.02

    # Optional crew symptom note / clinical observation
    symptom_notes: str = ""
    habitat_location: str = "Spacecraft"
    crew_id: str = "CDR-01"


@dataclass(frozen=True)
class HBMState:
    bone_mass_kg: float
    bone_mass_retention_pct: float
    monthly_bone_loss_rate: float
    spinal_elongation_cm: float
    effective_hut_shoulder_clearance_mm: float
    clavicle_impact_stress_pct: float
    cumulative_contact_trauma_score: float
    hydration_index: float
    career_dose_limit_pct: float
    red_bone_marrow_dose_msv: float
    eye_lens_dose_msv: float
    cns_dose_msv: float
    is_microgravity_adaptation_shift: bool

    def to_dict(self) -> Dict[str, float | bool]:
        return asdict(self)


def compute_hbm_state(t: TelemetryInput) -> HBMState:
    """
    Deterministic biomechanical & radiobiological digital twin state update.

    Bone mineral decay equation (Architecture Doc Section 2B):
      M_bone(t) = M_bone,0 * (1 - r_loss(E_ARED) * (t / 30))
      where r_loss ranges from 0.010 (100% ARED compliance) to 0.015 (0% compliance)
      and can reach 0.018 under elevated radiation / severe unloading.
    """
    e_ared = max(0.0, min(1.0, float(t.ared_compliance_14d)))
    met_days = max(0.0, float(t.mission_elapsed_days))

    # Monthly decay rate modulated by ARED compliance [0.008 .. 0.0165]
    r_loss = 0.0165 - (0.0080 * e_ared)
    decay_fraction = min(0.28, r_loss * (met_days / 30.0))
    bone_mass_kg = max(0.1, t.baseline_bone_mass_kg * (1.0 - decay_fraction))
    bone_retention_pct = (bone_mass_kg / max(0.1, t.baseline_bone_mass_kg)) * 100.0

    # Microgravity spinal elongation (~3-5 cm asymptote) reduces HUT shoulder clearance
    spinal_elongation_cm = 4.6 * (1.0 - pow(2.718281828, -met_days / 14.0))
    effective_clearance_mm = max(
        2.0,
        t.baseline_shoulder_clearance_mm - (spinal_elongation_cm * 1.45),
    )

    # Suit-to-clavicle blunt impact stress (% of osteopenic fracture threshold)
    osteopenia_factor = max(1.0, 100.0 / max(70.0, bone_retention_pct))
    clearance_penalty = max(1.0, 14.0 / max(4.0, effective_clearance_mm))
    clavicle_impact_stress_pct = min(
        150.0,
        (t.ltv_imu_peak_g * 22.0) * osteopenia_factor * (0.7 + 0.3 * clearance_penalty),
    )

    # Rolling cumulative contact trauma score (0-100 scale)
    contact_trauma_score = min(
        100.0,
        (t.recent_suit_impacts_7d * 11.5)
        + max(0.0, t.ltv_imu_peak_g - 1.2) * 18.0
        + max(0.0, 12.0 - effective_clearance_mm) * 2.8,
    )

    # Hydration index (1.0 = optimal; drops on rapid mass loss or low intake)
    intake_ratio = min(1.3, max(0.2, t.fluid_intake_l_24h / 2.5))
    mass_drop_penalty = max(0.0, (-t.mass_change_48h_kg - 0.5) * 0.18)
    hydration_index = max(0.35, min(1.25, intake_ratio - mass_drop_penalty))

    # Organ-specific radiation absorption weighting toward 600 mSv career limit
    career_limit_pct = (t.cumulative_career_msv / 600.0) * 100.0
    acute_event_factor = max(0.0, (t.dosimeter_rate_usv_hr / 1000.0) * 2.0)
    rbm_dose_msv = (t.cumulative_career_msv * 0.88) + (t.radin2_daily_usv * 0.0015) + acute_event_factor
    eye_lens_dose_msv = (t.cumulative_career_msv * 0.72) + (acute_event_factor * 1.35)
    cns_dose_msv = (t.cumulative_career_msv * 0.65) + (t.radin2_daily_usv * 0.0020)

    # Normal benign microgravity fluid shift flag (prevents false alarms)
    is_benign_shift = (
        t.systolic_bp_mmhg >= 100.0
        and t.systolic_bp_mmhg <= 138.0
        and t.resting_hr_bpm <= 92.0
        and t.cabin_ppco2_mmhg <= 2.3
        and t.goes_proton_flux_pfu < 5.0
    )

    return HBMState(
        bone_mass_kg=round(bone_mass_kg, 4),
        bone_mass_retention_pct=round(bone_retention_pct, 2),
        monthly_bone_loss_rate=round(r_loss, 4),
        spinal_elongation_cm=round(spinal_elongation_cm, 2),
        effective_hut_shoulder_clearance_mm=round(effective_clearance_mm, 2),
        clavicle_impact_stress_pct=round(clavicle_impact_stress_pct, 1),
        cumulative_contact_trauma_score=round(contact_trauma_score, 1),
        hydration_index=round(hydration_index, 3),
        career_dose_limit_pct=round(career_limit_pct, 2),
        red_bone_marrow_dose_msv=round(rbm_dose_msv, 2),
        eye_lens_dose_msv=round(eye_lens_dose_msv, 2),
        cns_dose_msv=round(cns_dose_msv, 2),
        is_microgravity_adaptation_shift=is_benign_shift,
    )
