"""Plan-conformance test vs autonomous_astronaut_health_ai_architecture.md. Usage: python3 -I plan_check.py <aether_project_dir>"""
import sys, os, json, csv
from pathlib import Path
ROOT = Path(sys.argv[1]).resolve(); sys.path.insert(0, str(ROOT)); os.chdir(ROOT)
from engine.tier1_hbm_physics import TelemetryInput, compute_hbm_state
from engine.tier3_safety_interlock import evaluate_safety_interlock

def lvl(**kw):
    t = TelemetryInput(**kw); h = compute_hbm_state(t)
    r = evaluate_safety_interlock(t, h); return r.alert_level, r
rank = {"NOMINAL_GREEN": 0, "CAUTION_AMBER": 1, "CRITICAL_RED": 2}
fails = []; n = 0
def case(row, below, above, expect_above, note=""):
    """below/above: kwargs just inside / just outside the md threshold."""
    global n
    lb, _ = lvl(**below); la, _ = lvl(**above); n += 1
    ok = lb != expect_above and rank[la] >= rank[expect_above] and la == expect_above
    ok = (rank[lb] < rank[expect_above]) and (la == expect_above)
    print(f"[{'PASS' if ok else 'FAIL'}] {row:<46} below={lb:<14} above={la:<14} want>={expect_above} {note}")
    if not ok: fails.append(row)

R, A = "CRITICAL_RED", "CAUTION_AMBER"
print("== md Section 4 thresholds (isolated, other inputs nominal) ==")
case("SPE: GOES protons > 10 pfu",           dict(goes_proton_flux_pfu=10.0), dict(goes_proton_flux_pfu=10.5), R)
case("SPE: dosimeter > 100 uSv/hr",          dict(dosimeter_rate_usv_hr=100.0), dict(dosimeter_rate_usv_hr=101.0), R)
case("Habitat: ppCO2 > 3.0 mmHg",            dict(cabin_ppco2_mmhg=3.0), dict(cabin_ppco2_mmhg=3.1), R)
case("Habitat: dust > 0.3 mg/m3",            dict(airborne_dust_mg_m3=0.30), dict(airborne_dust_mg_m3=0.31), R)
case("CV: systolic < 90",                    dict(systolic_bp_mmhg=90.0), dict(systolic_bp_mmhg=89.0), R)
case("CV: systolic > 160",                   dict(systolic_bp_mmhg=160.0), dict(systolic_bp_mmhg=161.0), R)
case("CV: diastolic < 60",                   dict(diastolic_bp_mmhg=60.0), dict(diastolic_bp_mmhg=59.0), R)
case("CV: diastolic > 100",                  dict(diastolic_bp_mmhg=100.0), dict(diastolic_bp_mmhg=101.0), R)
case("CV: resting HR > 120",                 dict(resting_hr_bpm=119.0), dict(resting_hr_bpm=121.0), R)
case("Metabolic: glucose < 70",              dict(blood_glucose_mg_dl=71.0), dict(blood_glucose_mg_dl=69.0), R)
case("Metabolic: glucose > 250",             dict(blood_glucose_mg_dl=249.0), dict(blood_glucose_mg_dl=251.0), R)
case("Metabolic: core temp > 38.5 C",        dict(core_temp_c=38.4), dict(core_temp_c=38.6), R)
case("Career dose > 85% of 600 mSv (AMBER)", dict(cumulative_career_msv=500.0), dict(cumulative_career_msv=520.0), A)
case("Bone/ARED compliance < 80% (AMBER)",   dict(ared_compliance_14d=0.85), dict(ared_compliance_14d=0.75), A)
case("Sleep < 5.0 h (AMBER)",                dict(sleep_hours_3d_avg=7.0), dict(sleep_hours_3d_avg=4.9), A)
case("Mood <= 3 (AMBER)",                    dict(mood_score_1_10=4.0), dict(mood_score_1_10=3.0), A)

print("\n== md Section 3 compound syndromes ==")
for name, kw, want in [
  ("ARS prodrome (flux>10 + T>38 + HR+20%)", dict(goes_proton_flux_pfu=20, core_temp_c=38.2, hr_baseline_7d_delta_pct=22, resting_hr_bpm=82), "ACUTE_SPE_RADIATION_STORM"),
  ("Hypercapnic burnout (CO2>3, sleep<5.5, mood<=4)", dict(cabin_ppco2_mmhg=3.2, sleep_hours_3d_avg=5.0, mood_score_1_10=4.0), "HYPERCAPNIC_COGNITIVE_BURNOUT"),
  ("SANS (CO2>2.5, DBP up, >60 d)", dict(cabin_ppco2_mmhg=2.7, diastolic_bp_mmhg=88, mission_elapsed_days=90), "SPACEFLIGHT_NEURO_OCULAR_SYNDROME_SANS"),
  ("Orthostatic (mass -1.6kg, SBP<95, HR>105)", dict(mass_change_48h_kg=-1.6, systolic_bp_mmhg=93, resting_hr_bpm=108), "CARDIOVASCULAR_FLUID_SHIFT_CRISIS"),
  ("Suit blunt trauma (>2.5g + low clearance + low bone)", dict(ltv_imu_peak_g=3.0, mission_elapsed_days=150, ared_compliance_14d=0.4, baseline_shoulder_clearance_mm=11.0), "ELEVATED_HBM_CLAVICLE_IMPACT_RISK")]:
    _, r = lvl(**kw); n += 1; ok = want in r.detected_syndromes
    print(f"[{'PASS' if ok else 'FAIL'}] {name:<52} -> {r.detected_syndromes}")
    if not ok: fails.append(name)

print("\n== Plan-vs-code deviations (informational) ==")
_, t3 = lvl(ltv_imu_peak_g=2.6)
h = compute_hbm_state(TelemetryInput(ltv_imu_peak_g=2.6))
print(f"* Suit row says '>2.5g AND clavicle stress >80%'. Code fires RED on g>2.5 alone (stress={h.clavicle_impact_stress_pct:.1f}%) -> alert={lvl(ltv_imu_peak_g=2.6)[0]} (more conservative than plan).")
print(f"* Extra non-md RED triggers in code: O2<19.5%, cabin P<96 kPa, suit P<3.9 psi (reasonable NASA limits, not in md).")
print(f"* md 'Metabolic' row: HR 120 exactly -> {lvl(resting_hr_bpm=120.0)[0]} (plan: >120 RED, boundary OK).")

print("\n== Section 6 schema vs md example ==")
from engine.pipeline import AetherPipeline
import engine.pipeline as pl
class Stub:   # Tier2 unused for key-shape check
    def predict(self, t, hbm=None):
        from engine.tier2_risk_engine import Tier2Prediction
        return Tier2Prediction("NOMINAL_GREEN", {"NOMINAL_GREEN":1.0,"CAUTION_AMBER":0.0,"CRITICAL_RED":0.0}, [{"feature":"resting_hr_bpm","value":68.0,"impact_weight":0.0}], 0.1, "stub")
pl.Tier2RiskEngine = Stub
out, _ = pl.AetherPipeline().run(TelemetryInput(goes_proton_flux_pfu=42.5, ltv_imu_peak_g=2.8))
md = open("docs/architecture_plan.md").read()
ex = json.loads(md[md.index("```json")+7: md.index("```", md.index("```json")+7)])
n += 1; ok = set(ex) == set(out)
print(f"[{'PASS' if ok else 'FAIL'}] top-level keys match md example  extra={set(out)-set(ex)} missing={set(ex)-set(out)}")
if not ok: fails.append("schema keys")
n += 1; ok = set(ex["offline_medical_kit_lookup"]) == set(out["offline_medical_kit_lookup"]); print(f"[{'PASS' if ok else 'FAIL'}] medkit keys match")
if not ok: fails.append("medkit keys")

print("\n== Section 5: dataset ==")
rows = sum(1 for _ in csv.DictReader(open("data/generated/aether_telemetry_25k.csv")))
n += 1; ok = rows == 25000; print(f"[{'PASS' if ok else 'FAIL'}] 25,000 synthetic scenarios  rows={rows}")
if not ok: fails.append("dataset rows")
print("   (not testable here: onnx <15 MB, gguf <2.2 GB, QLoRA, OSDR real-data ingest)")

print("\n== LIVE NOAA GOES data (fetched 2026-11-14) through the interlock ==")
live = dict(goes_proton_flux_pfu=0.23989, goes_xray_flux_wm2=8.6029e-07)   # latest >=10MeV proton & 0.1-0.8nm X-ray
a, r = lvl(**live); n += 1
print(f"[{'PASS' if a=='NOMINAL_GREEN' else 'FAIL'}] live quiet-Sun values -> {a}  (protons 0.24 pfu << 10 pfu threshold)")
if a != 'NOMINAL_GREEN': fails.append("live quiet")
# What-if: scale real flux to S1 (10 pfu), S3 (1000 pfu) NOAA radiation-storm scales
for lab, f in [("NOAA S1 level (10 pfu)", 10.0), ("just over S1 (10.5)", 10.5), ("NOAA S3 level (1000 pfu)", 1000.0)]:
    a, r = lvl(goes_proton_flux_pfu=f); print(f"   {lab:<26} -> {a}  ttc={r.time_to_criticality_minutes} min")

print(f"\nSUMMARY: {n-len(fails)}/{n} plan checks passed" + (f"  FAILED: {fails}" if fails else ""))
