"""
Build all reproducible Project AETHER datasets:
  1. aether_telemetry_25k.csv (25,000 physics-informed telemetry scenarios for Tier 2 LightGBM)
  2. aether_text_triplets_{train,eval}.jsonl (Contrastive triplets for EmbeddingGemma 2)
  3. aether_scan_images/ + aether_multimodal_triplets_{train,eval}.jsonl (Text + Vision scan triplets)
  4. aether_tier4_sft_{train,eval}.jsonl (Strict Section 6 JSON pairs for Tier 4 Action SLM)
"""
from __future__ import annotations

import csv
import json
import math
import random
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from engine.tier1_hbm_physics import TelemetryInput, compute_hbm_state
from engine.tier3_safety_interlock import evaluate_safety_interlock

DATA_DIR = Path(__file__).resolve().parent
OUT_DIR = DATA_DIR / "generated"
SCAN_DIR = OUT_DIR / "scan_images"

FEATURE_COLUMNS = [
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
    # Engineered HBM Physics Features (Tier 1 -> Tier 2)
    "hbm_bone_mass_retention_pct",
    "hbm_monthly_bone_loss_rate",
    "suit_shoulder_clearance_mm",
    "clavicle_impact_stress_pct",
    "cumulative_contact_trauma_score",
    "hydration_index",
    "career_dose_limit_pct",
]


def load_protocols() -> List[Dict]:
    protocols = []
    with (DATA_DIR / "nasa_protocols.jsonl").open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                protocols.append(json.loads(line))
    return protocols


def _sample_telemetry_scenario(rng: random.Random, scenario_type: str) -> Tuple[TelemetryInput, int, str]:
    """Generate physics-consistent telemetry including early prodromal & compound cases."""
    met = rng.uniform(5.0, 220.0)
    t_kwargs: Dict[str, float | int | str] = {
        "resting_hr_bpm": rng.gauss(68.0, 7.0),
        "hr_baseline_7d_delta_pct": rng.gauss(1.0, 4.0),
        "systolic_bp_mmhg": rng.gauss(118.0, 8.0),
        "diastolic_bp_mmhg": rng.gauss(76.0, 5.0),
        "hrv_rmssd_ms": max(15.0, rng.gauss(45.0, 10.0)),
        "blood_glucose_mg_dl": rng.gauss(95.0, 11.0),
        "core_temp_c": rng.gauss(36.8, 0.25),
        "fluid_intake_l_24h": max(1.4, rng.gauss(2.6, 0.35)),
        "mass_change_48h_kg": rng.gauss(-0.15, 0.25),
        "sleep_hours_3d_avg": max(3.5, min(9.5, rng.gauss(7.6, 0.7))),
        "sleep_efficiency_pct": max(55.0, min(97.0, rng.gauss(88.0, 4.5))),
        "mood_score_1_10": max(1.0, min(10.0, rng.gauss(7.8, 1.0))),
        "reaction_time_ms": max(170.0, rng.gauss(240.0, 22.0)),
        "mission_elapsed_days": met,
        "baseline_bone_mass_kg": rng.uniform(2.6, 3.6),
        "ared_compliance_14d": max(0.3, min(1.0, rng.uniform(0.82, 1.0))),
        "baseline_shoulder_clearance_mm": rng.uniform(16.0, 22.0),
        "suit_pressure_psi": rng.uniform(4.2, 4.4),
        "ltv_imu_peak_g": rng.uniform(0.1, 0.9),
        "recent_suit_impacts_7d": rng.randint(0, 1),
        "goes_proton_flux_pfu": rng.uniform(0.2, 2.5),
        "goes_xray_flux_wm2": 1e-7,
        "dosimeter_rate_usv_hr": rng.uniform(18.0, 38.0),
        "radin2_daily_usv": rng.uniform(350.0, 680.0),
        "cumulative_career_msv": rng.uniform(30.0, 320.0),
        "cabin_ppco2_mmhg": rng.uniform(1.1, 2.2),
        "cabin_o2_pct": rng.uniform(20.6, 21.4),
        "cabin_pressure_kpa": rng.uniform(100.5, 102.0),
        "airborne_dust_mg_m3": rng.uniform(0.01, 0.08),
    }

    if scenario_type == "benign_microgravity_shift":
        # Normal adaptation: mild HR/BP/facial shift without true hazard
        t_kwargs["resting_hr_bpm"] = rng.uniform(74.0, 88.0)
        t_kwargs["hr_baseline_7d_delta_pct"] = rng.uniform(4.0, 11.0)
        t_kwargs["systolic_bp_mmhg"] = rng.uniform(124.0, 136.0)
        t_kwargs["mass_change_48h_kg"] = rng.uniform(-0.8, -0.3)
    elif scenario_type == "prodromal_spe_ars":
        t_kwargs["goes_proton_flux_pfu"] = rng.uniform(11.0, 65.0)
        t_kwargs["dosimeter_rate_usv_hr"] = rng.uniform(110.0, 480.0)
        t_kwargs["core_temp_c"] = rng.uniform(37.9, 38.8)
        t_kwargs["hr_baseline_7d_delta_pct"] = rng.uniform(19.0, 38.0)
        t_kwargs["resting_hr_bpm"] = rng.uniform(88.0, 118.0)
        t_kwargs["mood_score_1_10"] = rng.uniform(2.5, 5.5)
    elif scenario_type == "suit_clavicle_trauma":
        t_kwargs["mission_elapsed_days"] = rng.uniform(90.0, 300.0)
        t_kwargs["ared_compliance_14d"] = rng.uniform(0.35, 0.72)
        t_kwargs["baseline_shoulder_clearance_mm"] = rng.uniform(14.0, 17.5)
        t_kwargs["ltv_imu_peak_g"] = rng.uniform(2.4, 4.2)
        t_kwargs["recent_suit_impacts_7d"] = rng.randint(3, 8)
    elif scenario_type == "orthostatic_fluid_crisis":
        t_kwargs["mass_change_48h_kg"] = rng.uniform(-2.6, -1.4)
        t_kwargs["fluid_intake_l_24h"] = rng.uniform(0.9, 1.7)
        t_kwargs["systolic_bp_mmhg"] = rng.uniform(78.0, 93.0)
        t_kwargs["diastolic_bp_mmhg"] = rng.uniform(50.0, 62.0)
        t_kwargs["resting_hr_bpm"] = rng.uniform(106.0, 134.0)
        t_kwargs["hrv_rmssd_ms"] = rng.uniform(10.0, 22.0)
    elif scenario_type == "metabolic_infectious_crisis":
        if rng.random() < 0.5:
            t_kwargs["blood_glucose_mg_dl"] = rng.uniform(46.0, 69.0)
            t_kwargs["resting_hr_bpm"] = rng.uniform(96.0, 124.0)
        else:
            t_kwargs["core_temp_c"] = rng.uniform(38.4, 39.8)
            t_kwargs["resting_hr_bpm"] = rng.uniform(102.0, 128.0)
    elif scenario_type == "eclss_co2_dust":
        t_kwargs["cabin_ppco2_mmhg"] = rng.uniform(3.05, 5.2)
        t_kwargs["airborne_dust_mg_m3"] = rng.uniform(0.28, 0.95)
        t_kwargs["reaction_time_ms"] = rng.uniform(310.0, 480.0)
    elif scenario_type == "sans_amber":
        t_kwargs["mission_elapsed_days"] = rng.uniform(65.0, 240.0)
        t_kwargs["cabin_ppco2_mmhg"] = rng.uniform(2.55, 2.98)
        t_kwargs["diastolic_bp_mmhg"] = rng.uniform(84.0, 96.0)
        t_kwargs["systolic_bp_mmhg"] = rng.uniform(132.0, 150.0)
    elif scenario_type == "bone_career_rad_amber":
        t_kwargs["mission_elapsed_days"] = rng.uniform(100.0, 320.0)
        t_kwargs["ared_compliance_14d"] = rng.uniform(0.35, 0.78)
        t_kwargs["cumulative_career_msv"] = rng.uniform(480.0, 585.0)
        t_kwargs["radin2_daily_usv"] = rng.uniform(900.0, 1650.0)
    elif scenario_type == "hypercapnic_burnout_amber":
        t_kwargs["cabin_ppco2_mmhg"] = rng.uniform(2.4, 2.95)
        t_kwargs["sleep_hours_3d_avg"] = rng.uniform(3.8, 5.4)
        t_kwargs["mood_score_1_10"] = rng.uniform(1.5, 4.0)
        t_kwargs["reaction_time_ms"] = rng.uniform(295.0, 410.0)
    elif scenario_type == "compound_spe_rover_bone":
        # Architecture Doc example: Solar Flare + Rover Jolt + Low Bone Mass
        t_kwargs["goes_proton_flux_pfu"] = rng.uniform(18.0, 75.0)
        t_kwargs["dosimeter_rate_usv_hr"] = rng.uniform(130.0, 390.0)
        t_kwargs["mission_elapsed_days"] = rng.uniform(110.0, 280.0)
        t_kwargs["ared_compliance_14d"] = rng.uniform(0.45, 0.75)
        t_kwargs["ltv_imu_peak_g"] = rng.uniform(2.3, 3.8)
        t_kwargs["baseline_shoulder_clearance_mm"] = rng.uniform(14.5, 17.0)

    t = TelemetryInput(**t_kwargs)  # type: ignore[arg-type]
    hbm = compute_hbm_state(t)
    interlock = evaluate_safety_interlock(t, hbm)

    # Also capture early multi-system prodromal warning (Class 1 AMBER) just before hard threshold
    label_map = {"NOMINAL_GREEN": 0, "CAUTION_AMBER": 1, "CRITICAL_RED": 2}
    y = label_map[interlock.alert_level]
    if y == 0 and scenario_type in {
        "prodromal_spe_ars",
        "suit_clavicle_trauma",
        "orthostatic_fluid_crisis",
        "sans_amber",
        "hypercapnic_burnout_amber",
    }:
        y = 1

    return t, y, scenario_type


def generate_telemetry_25k(n_rows: int = 25000, seed: int = 42) -> Path:
    rng = random.Random(seed)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = OUT_DIR / "aether_telemetry_25k.csv"

    scenario_weights = [
        ("nominal", 0.34),
        ("benign_microgravity_shift", 0.14),
        ("sans_amber", 0.08),
        ("bone_career_rad_amber", 0.08),
        ("hypercapnic_burnout_amber", 0.08),
        ("prodromal_spe_ars", 0.06),
        ("suit_clavicle_trauma", 0.06),
        ("orthostatic_fluid_crisis", 0.06),
        ("metabolic_infectious_crisis", 0.05),
        ("eclss_co2_dust", 0.03),
        ("compound_spe_rover_bone", 0.02),
    ]
    names, weights = zip(*scenario_weights)

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(FEATURE_COLUMNS + ["label_alert", "scenario_type"])
        for _ in range(n_rows):
            sc = rng.choices(names, weights=weights, k=1)[0]
            t, y, sc_name = _sample_telemetry_scenario(rng, sc)
            hbm = compute_hbm_state(t)
            row = [
                round(t.resting_hr_bpm, 2),
                round(t.hr_baseline_7d_delta_pct, 2),
                round(t.systolic_bp_mmhg, 2),
                round(t.diastolic_bp_mmhg, 2),
                round(t.hrv_rmssd_ms, 2),
                round(t.blood_glucose_mg_dl, 2),
                round(t.core_temp_c, 2),
                round(t.fluid_intake_l_24h, 2),
                round(t.mass_change_48h_kg, 3),
                round(t.sleep_hours_3d_avg, 2),
                round(t.sleep_efficiency_pct, 2),
                round(t.mood_score_1_10, 2),
                round(t.reaction_time_ms, 1),
                round(t.mission_elapsed_days, 1),
                round(t.ared_compliance_14d, 3),
                round(t.suit_pressure_psi, 2),
                round(t.ltv_imu_peak_g, 2),
                t.recent_suit_impacts_7d,
                round(t.goes_proton_flux_pfu, 2),
                round(t.dosimeter_rate_usv_hr, 2),
                round(t.radin2_daily_usv, 1),
                round(t.cumulative_career_msv, 2),
                round(t.cabin_ppco2_mmhg, 3),
                round(t.cabin_o2_pct, 2),
                round(t.cabin_pressure_kpa, 2),
                round(t.airborne_dust_mg_m3, 3),
                hbm.bone_mass_retention_pct,
                hbm.monthly_bone_loss_rate,
                hbm.effective_hut_shoulder_clearance_mm,
                hbm.clavicle_impact_stress_pct,
                hbm.cumulative_contact_trauma_score,
                hbm.hydration_index,
                hbm.career_dose_limit_pct,
                y,
                sc_name,
            ]
            writer.writerow(row)
    return csv_path


def generate_text_triplets(protocols: List[Dict], seed: int = 42) -> Tuple[Path, Path]:
    """Generate domain-rich contrastive triplets with hard negatives and strict query-disjoint eval."""
    rng = random.Random(seed)
    proto_by_id = {p["id"]: p for p in protocols}

    # Tuple: (train_queries, held_out_eval_queries, hard_negative_pids)
    query_bank: Dict[str, Tuple[List[str], List[str], List[str]]] = {
        "PROTO-SPE-01": (
            [
                "Solar proton flux jumped above 10 pfu during lunar EVA with sudden nausea and fever",
                "GOES particle storm alert > 100 uSv/hr dosimeter rate, crew HR up 22%, core temp 38.2 C",
                "Acute radiation prodrome inside rover: fatigue, nausea, proton spike, need shelter window",
                "High solar particle event radiation warning while outside habitat, deploy water shielding",
                "Sudden fever 38.3 C with resting pulse +25% during active GOES solar flare proton storm",
            ],
            [
                "Prodromal acute radiation sickness symptoms post-flare: emesis risk and sternum marrow dose",
                "Emergency shelter protocol for acute SPE proton flux > 40 pfu and HERA dosimeter spike",
            ],
            ["PROTO-MET-01", "PROTO-RAD-02", "PROTO-SUIT-01"],
        ),
        "PROTO-RAD-02": (
            [
                "Cumulative career radiation dose reached 525 mSv out of 600 mSv limit on Mars transit",
                "Radi-N2 daily neutron bubble detector counts climbing in sleeping quarters during solar minimum",
                "Chronic galactic cosmic ray organ dose approaching eye lens and red bone marrow limit",
                "Need sleep zone reassignment to lower neutron habitat module and antioxidant plan",
            ],
            [
                "87% career radiation exposure logged on long-duration deep space mission, restrict EVAs",
                "High GCR organ dose accumulation without acute proton storm requires bunk shielding relocation",
            ],
            ["PROTO-SPE-01", "PROTO-SANS-01", "PROTO-BONE-02"],
        ),
        "PROTO-SUIT-01": (
            [
                "LTV rover hit crater bump 3.1g jolt, left shoulder pain against spacesuit hard upper torso",
                "Clavicle tenderness after 2.8g rover impact with tight HUT clearance and low bone retention",
                "Spacesuit blunt shoulder trauma with bone mass 90% and possible decompression leak check",
                "Check PLSS suit pressure seal and portable ultrasound for rib fracture or pneumothorax",
            ],
            [
                "Repetitive suit scye ring contact trauma on osteopenic collarbone during lunar drive",
                "Spacesuit torso impact over 2.5g with compressed shoulder clearance demanding Tempus Pro check",
            ],
            ["PROTO-BONE-02", "PROTO-SPE-01", "PROTO-CV-01"],
        ),
        "PROTO-BONE-02": (
            [
                "ARED resistive workout compliance dropped to 62% over 14 days, bone loss rate 1.6% per month",
                "Gradual femoral neck and lumbar spine mineral density decline on SLAMMD and DEXA model",
                "Mandatory resistive deadlift and squat load increase plus vitamin D3 and calcium check",
                "Prevent microgravity osteopenia progression after missed ARED exercise sessions",
            ],
            [
                "Chronic musculoskeletal deconditioning trend over two weeks without acute trauma",
                "Long-duration bone mass drop requiring resistive resistance recalibration and Slammd verification",
            ],
            ["PROTO-SUIT-01", "PROTO-RAD-02", "PROTO-NOM-01"],
        ),
        "PROTO-CV-01": (
            [
                "Crewmember dizzy standing up, BP 84/56 mmHg, resting heart rate 116 bpm, lost 1.8 kg in 48 hours",
                "Severe orthostatic intolerance and plasma volume depletion after microgravity transition",
                "Hypertensive spike 168/104 mmHg or hypotensive syncope risk requiring Chibis LBNP suit",
                "Rapid dehydration mass drop with tachycardia > 120 bpm, check internal jugular vein ultrasound",
            ],
            [
                "Post-EVA lightheadedness, low systolic blood pressure < 90, oral salt-water fluid loading",
                "Presyncope with plummeting arterial pressure and plasma hypovolemia needing supine elevation",
            ],
            ["PROTO-MET-01", "PROTO-SANS-01", "PROTO-NOM-01"],
        ),
        "PROTO-MET-01": (
            [
                "Blood glucose crashed to 58 mg/dL post-rover sortie with tremor, sweating and confusion",
                "High fever 38.9 C with suspected infectious illness, need i-STAT blood lactate and isolation",
                "Hyperglycemia blood sugar 275 mg/dL requiring insulin protocol and offline OpenFDA dosing",
                "Dizziness, feverish 38.6 C, low blood sugar 65 mg/dL after EVA requiring glucose gel",
            ],
            [
                "Acute metabolic hypoglycemia or febrile infection without solar proton flux elevation",
                "Severe glycemic drop with neuroglycopenic confusion needing 15g glucose and i-STAT blood gas",
            ],
            ["PROTO-SPE-01", "PROTO-CV-01", "PROTO-ECLSS-01"],
        ),
        "PROTO-ECLSS-01": (
            [
                "Cabin ppCO2 breached 3.4 mmHg with lunar regolith dust 0.45 mg/m3 in airlock",
                "Toxic habitat atmosphere: CO2 > 3.0 mmHg, O2 falling below 19.5%, burning eyes and cough",
                "Airborne Martian silicate dust contamination requiring masks, goggles, and CDRA scrubber boost",
                "Immediate closed-loop O2 reserve switch and electrostatic dust repeller activation",
            ],
            [
                "Acute hypercapnic airlock leak and regolith inhalation emergency",
                "Cabin carbon dioxide above 3 mmHg and oxygen drop requiring immediate respirator masks",
            ],
            ["PROTO-MIND-01", "PROTO-SANS-01", "PROTO-MET-01"],
        ),
        "PROTO-SANS-01": (
            [
                "Blurred near vision and hyperopic shift on mission day 95 with ppCO2 2.7 mmHg and BP 136/88",
                "Suspected Spaceflight-Associated Neuro-ocular Syndrome optic disc edema on fundus photo",
                "Headward fluid shift elevating intracranial pressure and flattening posterior eye globe",
                "Need ocular ultrasound optic nerve sheath diameter scan and CO2 scrubbing below 2.0 mmHg",
            ],
            [
                "Chronic microgravity vision changes after 60+ days with elevated diastolic pressure",
                "Posterior eye flattening and visual acuity decline linked to cephalad fluid redistribution",
            ],
            ["PROTO-MIND-01", "PROTO-RAD-02", "PROTO-CV-01"],
        ),
        "PROTO-MIND-01": (
            [
                "Sleeping under 4.8 hours for 3 nights, mood score 2/5, slow reaction time, cabin ppCO2 2.6",
                "Hypercapnic cognitive burnout and isolation fatigue degrading executive docking judgment",
                "Crewmember irritable and exhausted after dust lock maintenance, enforce 8.5h sleep block",
                "Circadian desynchronization needing blue-enriched 480nm morning LED shift and EVA deferral",
            ],
            [
                "Severe sleep deprivation and psychological isolation drop without acute vitals crash",
                "Sustained sleep deficit below 5 hours hurting cognitive reaction time under elevated CO2",
            ],
            ["PROTO-ECLSS-01", "PROTO-SANS-01", "PROTO-NOM-01"],
        ),
        "PROTO-NOM-01": (
            [
                "Morning check nominal: BP 118/76, HR 66 bpm, glucose 94 mg/dL, sleep 7.5 hrs, mood 5/5",
                "Mild normal microgravity fluid shift with all NASA-STD-3001 thresholds inside green limits",
                "Routine post-workout vitals stable, log daily telemetry to earn Aegis XP",
            ],
            [
                "No emergency findings, continue standard ARED schedule and 2.5L hydration",
                "Baseline astronaut vital check completely within normal operational envelope",
            ],
            ["PROTO-CV-01", "PROTO-BONE-02", "PROTO-MIND-01"],
        ),
    }

    locations = ["Spacecraft", "Lunar Habitat", "Mars Transit", "LTV Rover", "Airlock"]
    train_rows: List[Dict[str, str]] = []
    eval_rows: List[Dict[str, str]] = []

    for pid, (train_qs, eval_qs, hard_negs) in query_bank.items():
        pos_doc = proto_by_id[pid]["document_text"]
        for q in train_qs:
            for neg_pid in hard_negs:
                train_rows.append({
                    "anchor": q,
                    "positive": pos_doc,
                    "negative": proto_by_id[neg_pid]["document_text"],
                    "target_id": pid,
                })
        for _ in range(170):
            base_q = rng.choice(train_qs)
            loc = rng.choice(locations)
            met = rng.randint(12, 240)
            train_rows.append({
                "anchor": f"{base_q} (location: {loc}, mission day {met})",
                "positive": pos_doc,
                "negative": proto_by_id[rng.choice(hard_negs)]["document_text"],
                "target_id": pid,
            })

        for q in eval_qs:
            for neg_pid in hard_negs:
                eval_rows.append({
                    "anchor": q,
                    "positive": pos_doc,
                    "negative": proto_by_id[neg_pid]["document_text"],
                    "target_id": pid,
                })
            for _ in range(18):
                loc = rng.choice(locations)
                met = rng.randint(15, 250)
                eval_rows.append({
                    "anchor": f"{q} (station: {loc}, MET day {met})",
                    "positive": pos_doc,
                    "negative": proto_by_id[rng.choice(hard_negs)]["document_text"],
                    "target_id": pid,
                })

    rng.shuffle(train_rows)
    rng.shuffle(eval_rows)

    train_path = OUT_DIR / "aether_text_triplets_train.jsonl"
    eval_path = OUT_DIR / "aether_text_triplets_eval.jsonl"
    for path, rows in ((train_path, train_rows), (eval_path, eval_rows)):
        with path.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    return train_path, eval_path


def _render_medical_scan(kind: str, variant: int, rng: random.Random, size: int = 224) -> Image.Image:
    """
    Render distinct clinical phantom medical scans (fundus, skin erythema, ultrasound, clavicle)
    so Text+Vision EmbeddingGemma 2 training/evaluation runs reproducibly offline & in Colab.
    """
    img = Image.new("RGB", (size, size), (14, 18, 24))
    draw = ImageDraw.Draw(img)

    jitter_x = rng.randint(-12, 12)
    jitter_y = rng.randint(-12, 12)

    if kind in {"ocular_fundus_sans", "ocular_fundus_normal"}:
        # Dark outer bezel + glowing retinal fundus circle + vascular branches
        draw.ellipse((14, 14, size - 14, size - 14), fill=(165, 58, 32))
        cx, cy = size // 2 + jitter_x, size // 2 + jitter_y
        # Vascular tree
        for angle in (0.3, 0.9, 2.2, 2.8, 3.6, 4.3, 5.4):
            x2 = int(cx + math.cos(angle) * 78)
            y2 = int(cy + math.sin(angle) * 78)
            draw.line((cx, cy, x2, y2), fill=(105, 22, 16), width=3)
        if kind == "ocular_fundus_sans":
            # Swollen blurred optic disc (papilledema) + choroidal folds
            draw.ellipse((cx - 28, cy - 28, cx + 28, cy + 28), fill=(255, 225, 130))
            draw.ellipse((cx - 34, cy - 34, cx + 34, cy + 34), outline=(255, 165, 70), width=4)
            for k in range(-20, 25, 10):
                draw.arc((cx - 50, cy + k - 15, cx + 50, cy + k + 15), 10, 170, fill=(210, 110, 50), width=2)
            img = img.filter(ImageFilter.GaussianBlur(radius=1.2))
        else:
            # Crisp normal optic disc margin + clear cup
            draw.ellipse((cx - 18, cy - 18, cx + 18, cy + 18), fill=(248, 200, 118))
            draw.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=(255, 238, 185))

    elif kind in {"skin_erythema_radiation", "skin_normal"}:
        base_r, base_g, base_b = rng.randint(185, 215), rng.randint(145, 170), rng.randint(120, 145)
        draw.rectangle((0, 0, size, size), fill=(base_r, base_g, base_b))
        if kind == "skin_erythema_radiation":
            # Acute demarcated erythema / radiation rash patches
            for _ in range(rng.randint(3, 6)):
                rx = rng.randint(45, size - 45)
                ry = rng.randint(45, size - 45)
                rad = rng.randint(24, 52)
                draw.ellipse((rx - rad, ry - rad, rx + rad, ry + rad), fill=(215, 58, 62))
                draw.ellipse((rx - rad // 2, ry - rad // 2, rx + rad // 2, ry + rad // 2), fill=(235, 92, 85))
            img = img.filter(ImageFilter.GaussianBlur(radius=3.5))
        else:
            # Uniform healthy dermis micro-texture
            for _ in range(30):
                px, py = rng.randint(10, size - 10), rng.randint(10, size - 10)
                draw.point((px, py), fill=(base_r - 12, base_g - 10, base_b - 10))
            img = img.filter(ImageFilter.GaussianBlur(radius=0.8))

    elif kind in {"thoracic_ultrasound_pneumothorax", "thoracic_ultrasound_normal"}:
        # Ultrasound sector cone
        draw.polygon([(size // 2, 12), (16, size - 12), (size - 16, size - 12)], fill=(22, 26, 32))
        # Rib shadows + pleural line
        draw.line((40, 86 + jitter_y // 2, size - 40, 86 + jitter_y // 2), fill=(235, 240, 245), width=4)
        if kind == "thoracic_ultrasound_pneumothorax":
            # Prominent vertical B-lines / barcode stratification (no lung sliding)
            for y_bar in range(96, size - 20, 10):
                c = rng.randint(140, 215)
                draw.line((38, y_bar, size - 38, y_bar), fill=(c, c, c + 10), width=3)
        else:
            # Granular "sandy beach" normal aeration below pleural line
            for _ in range(380):
                px = rng.randint(40, size - 40)
                py = rng.randint(94, size - 18)
                v = rng.randint(70, 150)
                draw.point((px, py), fill=(v, v, v))
        img = img.filter(ImageFilter.GaussianBlur(radius=0.7))

    elif kind in {"bone_clavicle_fracture", "bone_clavicle_intact"}:
        # Radiograph / high-freq bone scan background
        draw.rectangle((0, 0, size, size), fill=(18, 22, 28))
        y_mid = size // 2 + jitter_y
        if kind == "bone_clavicle_fracture":
            # Cortical discontinuity with displaced fracture gap + soft tissue swelling halo
            draw.ellipse((size // 2 - 36, y_mid - 32, size // 2 + 36, y_mid + 32), fill=(48, 52, 60))
            draw.line((22, y_mid + 8, size // 2 - 7, y_mid - 6), fill=(232, 236, 240), width=16)
            draw.line((size // 2 + 7, y_mid + 12, size - 22, y_mid - 4), fill=(232, 236, 240), width=16)
            draw.line((size // 2 - 5, y_mid - 18, size // 2 + 5, y_mid + 20), fill=(14, 16, 20), width=5)
        else:
            # Continuous intact cortical clavicle shaft
            draw.arc((20, y_mid - 26, size - 20, y_mid + 26), 190, 350, fill=(230, 235, 240), width=15)
        img = img.filter(ImageFilter.GaussianBlur(radius=0.9))

    # Add light sensor noise for generalization
    arr = np.asarray(img, dtype=np.int16)
    noise = np.random.default_rng(variant + 100).integers(-8, 9, size=arr.shape)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def generate_multimodal_scan_triplets(protocols: List[Dict], seed: int = 42) -> Tuple[Path, Path]:
    """Generate cross-modal (text <-> medical scan image) triplets for Text+Vision EmbeddingGemma 2."""
    rng = random.Random(seed)
    SCAN_DIR.mkdir(parents=True, exist_ok=True)
    proto_by_id = {p["id"]: p for p in protocols}

    # Tuple: (pos_kind, proto_id, neg_kind, train_queries, eval_queries)
    scan_specs = [
        (
            "ocular_fundus_sans",
            "PROTO-SANS-01",
            "ocular_fundus_normal",
            [
                "Retinal fundus photograph showing optic disc edema and choroidal folds in SANS",
                "Check eye scan photo for Spaceflight-Associated Neuro-ocular Syndrome papilledema",
            ],
            [
                "Ocular fundus image with blurred optic nerve margin after elevated ppCO2",
            ],
        ),
        (
            "ocular_fundus_normal",
            "PROTO-NOM-01",
            "ocular_fundus_sans",
            [
                "Normal crisp retinal optic disc scan without papilledema or fluid shift",
            ],
            [
                "Baseline healthy ocular fundus check inside nominal green range",
            ],
        ),
        (
            "skin_erythema_radiation",
            "PROTO-SPE-01",
            "skin_normal",
            [
                "Skin photograph showing acute erythematous radiation rash after solar proton exposure",
                "Demarcated red skin erythema from acute SPE radiation or thermal hazard",
            ],
            [
                "Check crew dermal scan photo for radiation skin injury",
            ],
        ),
        (
            "skin_normal",
            "PROTO-NOM-01",
            "skin_erythema_radiation",
            [
                "Healthy intact epidermis skin photo with no rash or radiation erythema",
            ],
            [
                "Normal baseline skin check post-EVA",
            ],
        ),
        (
            "thoracic_ultrasound_pneumothorax",
            "PROTO-ECLSS-01",
            "thoracic_ultrasound_normal",
            [
                "Thoracic lung ultrasound scan showing pleural stratification and absent sliding",
                "Chest ultrasound B-lines after lunar dust toxicity or suit decompression barotrauma",
            ],
            [
                "Check portable lung ultrasound image for pneumothorax or pulmonary edema",
            ],
        ),
        (
            "thoracic_ultrasound_normal",
            "PROTO-NOM-01",
            "thoracic_ultrasound_pneumothorax",
            [
                "Normal thoracic ultrasound seashore sign with healthy lung aeration",
            ],
            [
                "Routine baseline chest ultrasound image without pleural fluid or air leak",
            ],
        ),
        (
            "bone_clavicle_fracture",
            "PROTO-SUIT-01",
            "bone_clavicle_intact",
            [
                "Shoulder bone scan showing clavicle cortical fracture at spacesuit HUT interface",
                "Left clavicle fracture gap after 3g lunar rover impact inside osteopenic crew",
            ],
            [
                "Check skeletal scan image for HUT collarbone break",
            ],
        ),
        (
            "bone_clavicle_intact",
            "PROTO-NOM-01",
            "bone_clavicle_fracture",
            [
                "Intact continuous clavicle bone cortex without fracture or displacement",
            ],
            [
                "Normal baseline shoulder bone scan post-EVA",
            ],
        ),
    ]

    image_paths_by_kind: Dict[str, List[str]] = {}
    samples_per_kind = 18
    for kind, _, _, _, _ in scan_specs:
        paths = []
        for idx in range(samples_per_kind):
            im = _render_medical_scan(kind, idx, rng)
            p = SCAN_DIR / f"{kind}_{idx:02d}.png"
            im.save(p)
            paths.append(str(p.relative_to(OUT_DIR)))
        image_paths_by_kind[kind] = paths

    split_idx = int(samples_per_kind * 0.78)
    train_rows, eval_rows = [], []
    for pos_kind, pid, neg_kind, train_qs, eval_qs in scan_specs:
        pos_imgs = image_paths_by_kind[pos_kind]
        neg_imgs = image_paths_by_kind[neg_kind]
        doc_text = proto_by_id[pid]["document_text"]

        for idx in range(samples_per_kind):
            is_train = idx < split_idx
            q = train_qs[idx % len(train_qs)] if is_train else eval_qs[idx % len(eval_qs)]
            row_t2i = {
                "direction": "text_to_image",
                "anchor": q,
                "positive_image": pos_imgs[idx],
                "negative_image": neg_imgs[idx],
                "protocol_id": pid,
            }
            neg_pid = "PROTO-NOM-01" if pid != "PROTO-NOM-01" else "PROTO-SANS-01"
            row_i2t = {
                "direction": "image_to_text",
                "anchor_image": pos_imgs[idx],
                "positive": doc_text,
                "negative": proto_by_id[neg_pid]["document_text"],
                "protocol_id": pid,
            }
            if is_train:
                train_rows.extend([row_t2i, row_i2t])
            else:
                eval_rows.extend([row_t2i, row_i2t])

    train_path = OUT_DIR / "aether_multimodal_triplets_train.jsonl"
    eval_path = OUT_DIR / "aether_multimodal_triplets_eval.jsonl"
    for path, rows in ((train_path, train_rows), (eval_path, eval_rows)):
        with path.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    return train_path, eval_path


def generate_tier4_sft(protocols: List[Dict], n_examples: int = 3000, seed: int = 42) -> Tuple[Path, Path]:
    """Generate strict Section 6 JSON SFT pairs for Notebook 2 Tier 4 Action SLM QLoRA."""
    import jsonschema

    with (DATA_DIR / "schema" / "triage_output.schema.json").open("r", encoding="utf-8") as sf:
        schema = json.load(sf)

    rng = random.Random(seed)
    proto_by_id = {p["id"]: p for p in protocols}

    scenario_pool = [
        ("nominal", "PROTO-NOM-01"),
        ("benign_microgravity_shift", "PROTO-NOM-01"),
        ("prodromal_spe_ars", "PROTO-SPE-01"),
        ("suit_clavicle_trauma", "PROTO-SUIT-01"),
        ("orthostatic_fluid_crisis", "PROTO-CV-01"),
        ("metabolic_infectious_crisis", "PROTO-MET-01"),
        ("eclss_co2_dust", "PROTO-ECLSS-01"),
        ("sans_amber", "PROTO-SANS-01"),
        ("bone_career_rad_amber", "PROTO-RAD-02"),
        ("hypercapnic_burnout_amber", "PROTO-MIND-01"),
        ("compound_spe_rover_bone", "PROTO-SPE-01"),
    ]

    records = []
    for i in range(n_examples):
        sc_type, primary_pid = scenario_pool[i % len(scenario_pool)]
        t, _, _ = _sample_telemetry_scenario(rng, sc_type)
        hbm = compute_hbm_state(t)
        interlock = evaluate_safety_interlock(t, hbm)

        active_pids = interlock.triggered_protocol_ids or [primary_pid]
        primary = proto_by_id[active_pids[0]]

        shap_items = []
        seen_feats = set()
        for feat, val, wt in interlock.deterministic_reasons:
            if feat in seen_feats:
                continue
            seen_feats.add(feat)
            shap_items.append({
                "feature": feat,
                "value": round(float(val), 2),
                "impact_weight": round(max(0.0, min(1.0, float(wt))), 2),
            })
            if len(shap_items) >= 3:
                break
        if not shap_items:
            shap_items = [
                {"feature": "resting_hr_bpm", "value": round(t.resting_hr_bpm, 1), "impact_weight": 0.45},
                {"feature": "systolic_bp_mmhg", "value": round(t.systolic_bp_mmhg, 1), "impact_weight": 0.32},
                {"feature": "hbm_bone_mass_retention_pct", "value": hbm.bone_mass_retention_pct, "impact_weight": 0.23},
            ]

        zones = []
        seen_zones = set()
        actions = []
        directives = []
        for pid in active_pids:
            p = proto_by_id[pid]
            for z in p["hbm_zones"]:
                if z["anatomical_region"] not in seen_zones:
                    seen_zones.add(z["anatomical_region"])
                    zones.append(z)
            for a in p["crew_actions"]:
                if a not in actions:
                    actions.append(a)
            for d in p["hardware_directives"]:
                if d not in directives:
                    directives.append(d)

        target_json = {
            "timestamp_utc": "2026-11-14T19:26:00Z",
            "comms_mode": "OFFLINE_AUTONOMOUS_EDGE",
            "alert_level": interlock.alert_level,
            "time_to_criticality_minutes": interlock.time_to_criticality_minutes,
            "detected_syndromes": interlock.detected_syndromes,
            "shap_root_causes": shap_items,
            "hbm_3d_highlight_zones": zones[:4],
            "immediate_crew_actions": actions[:4],
            "hardware_bus_directives": directives[:4],
            "offline_medical_kit_lookup": primary["med_kit"],
        }
        if i < 20:
            jsonschema.validate(instance=target_json, schema=schema)

        prompt = (
            "You are Project AETHER Autonomous Flight Surgeon AI. Output ONLY strict Section 6 JSON.\n"
            f"TELEMETRY: HR={t.resting_hr_bpm:.1f}bpm, BP={t.systolic_bp_mmhg:.0f}/{t.diastolic_bp_mmhg:.0f}mmHg, "
            f"Glucose={t.blood_glucose_mg_dl:.0f}mg/dL, Temp={t.core_temp_c:.1f}C, Sleep={t.sleep_hours_3d_avg:.1f}h, "
            f"ppCO2={t.cabin_ppco2_mmhg:.2f}mmHg, Dust={t.airborne_dust_mg_m3:.2f}mg/m3, "
            f"GOES_Proton={t.goes_proton_flux_pfu:.1f}pfu, LTV_g={t.ltv_imu_peak_g:.2f}g\n"
            f"HBM_STATE: BoneRetention={hbm.bone_mass_retention_pct}%, ShoulderClearance={hbm.effective_hut_shoulder_clearance_mm}mm, "
            f"CareerRad={hbm.career_dose_limit_pct}%, Hydration={hbm.hydration_index}\n"
            f"INTERLOCK_ALERT={interlock.alert_level}, TTC_MIN={interlock.time_to_criticality_minutes}\n"
            f"RETRIEVED_PROTOCOLS={[proto_by_id[p]['title'] for p in active_pids]}"
        )
        records.append({
            "instruction": prompt,
            "output_json": json.dumps(target_json),
        })

    rng.shuffle(records)
    split = int(len(records) * 0.88)
    train_path = OUT_DIR / "aether_tier4_sft_train.jsonl"
    eval_path = OUT_DIR / "aether_tier4_sft_eval.jsonl"
    for path, rows in ((train_path, records[:split]), (eval_path, records[split:])):
        with path.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    return train_path, eval_path


def main() -> None:
    protocols = load_protocols()
    tel_csv = generate_telemetry_25k()
    text_train, text_eval = generate_text_triplets(protocols)
    mm_train, mm_eval = generate_multimodal_scan_triplets(protocols)
    sft_train, sft_eval = generate_tier4_sft(protocols)
    print("Generated Project AETHER datasets:")
    for p in (tel_csv, text_train, text_eval, mm_train, mm_eval, sft_train, sft_eval):
        print(f"  - {p} ({p.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
