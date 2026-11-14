"""Independent oracle test: re-implements the md Sec.4 thresholds from the written plan only (NOT from interlock code) and compares
the full pipeline's final alert on randomized scenarios. Derived physics (bone loss rate, clavicle stress) come from Tier 1.
python3 -I scripts/oracle_check.py <project_dir>
"""
import sys, os, random, collections, json
from pathlib import Path
ROOT = Path(sys.argv[1]).resolve(); sys.path.insert(0, str(ROOT)); os.chdir(ROOT)
from engine.tier1_hbm_physics import TelemetryInput, compute_hbm_state
import engine.pipeline as pl
R = {"NOMINAL_GREEN": 0, "CAUTION_AMBER": 1, "CRITICAL_RED": 2}

def oracle(t, h):
    """md Section 4 only."""
    red = (t.goes_proton_flux_pfu > 10 or t.dosimeter_rate_usv_hr > 100
           or (t.ltv_imu_peak_g > 2.5 and h.clavicle_impact_stress_pct > 80)
           or t.systolic_bp_mmhg < 90 or t.diastolic_bp_mmhg < 60 or t.systolic_bp_mmhg > 160 or t.diastolic_bp_mmhg > 100 or t.resting_hr_bpm > 120
           or t.blood_glucose_mg_dl < 70 or t.blood_glucose_mg_dl > 250 or t.core_temp_c > 38.5
           or t.cabin_ppco2_mmhg > 3.0 or t.airborne_dust_mg_m3 > 0.3)
    amber = (t.cumulative_career_msv > 0.85 * 600 or h.monthly_bone_loss_rate > 0.015 or t.ared_compliance_14d < 0.80
             or t.sleep_hours_3d_avg < 5.0 or t.mood_score_1_10 <= 3)
    return 2 if red else (1 if amber else 0)

rng = random.Random(7)
def sample():
    """mixture: mostly healthy-ish with random excursions, some boundary-hugging values"""
    kw = dict(resting_hr_bpm=rng.gauss(70, 9), systolic_bp_mmhg=rng.gauss(118, 9), diastolic_bp_mmhg=rng.gauss(76, 6), blood_glucose_mg_dl=rng.gauss(94, 9),
              core_temp_c=rng.gauss(36.8, 0.25), sleep_hours_3d_avg=rng.gauss(7.2, 1.0), mood_score_1_10=min(10, max(1, rng.gauss(7.5, 1.6))),
              cabin_ppco2_mmhg=abs(rng.gauss(1.6, 0.6)), airborne_dust_mg_m3=abs(rng.gauss(0.03, 0.03)), goes_proton_flux_pfu=abs(rng.lognormvariate(0, 1.2)),
              dosimeter_rate_usv_hr=abs(rng.gauss(30, 25)), ltv_imu_peak_g=abs(rng.gauss(0.8, 0.9)), ared_compliance_14d=min(1, max(0, rng.gauss(0.88, 0.1))),
              cumulative_career_msv=rng.uniform(40, 560), mission_elapsed_days=rng.uniform(5, 200), mass_change_48h_kg=rng.gauss(-0.2, 0.6),
              recent_suit_impacts_7d=rng.choice([0, 0, 0, 1, 3, 6]))
    return kw

# stub Tier2 -> isolates the deterministic + RAG + Tier4 path from ML (ML can only add AMBER anyway)
pipe = pl.AetherPipeline(); N = 4000
conf = collections.Counter(); diffs = collections.Counter(); red_miss = 0
for _ in range(N):
    kw = sample(); t = TelemetryInput(**kw); h = compute_hbm_state(t)
    o = oracle(t, h); out, d = pipe.run(t); p = R[out["alert_level"]]
    conf[(o, p)] += 1
    if o != p:
        why = []
        if t.ltv_imu_peak_g > 2.5 and not h.clavicle_impact_stress_pct > 80: why.append("suit_g_only(code OR vs md AND)")
        if t.sleep_hours_3d_avg < 5.5 and t.sleep_hours_3d_avg >= 5.0: why.append("sleep 5.0-5.5 (code stricter)")
        if h.bone_mass_retention_pct < 92.5: why.append("bone_retention<92.5 (code extra amber)")
        if t.cabin_o2_pct < 19.5 or t.cabin_pressure_kpa < 96 or t.suit_pressure_psi < 3.9: why.append("extra RED limits")
        if (t.resting_hr_bpm >= 100 and t.resting_hr_bpm <= 120) or 37.6 <= t.core_temp_c <= 38.5 or 70 <= t.blood_glucose_mg_dl < 78 or 200 <= t.blood_glucose_mg_dl <= 250: why.append("borderline vitals amber (code extra)")
        if p == 1 and o == 0 and not why: why.append("ML early-warning amber")
        diffs[(o, p, why[0] if why else "other")] += 1
    if o == 2 and p < 2: red_miss += 1
n_ok = sum(v for (o, p), v in conf.items() if o == p)
print(f"N={N}  exact agreement with md oracle: {n_ok/N:.4f}   RED missed vs md: {red_miss}")
mix = collections.Counter()
for (o, p), v in conf.items(): mix[o] += v
print("class mix (oracle G/A/R):", [mix[0], mix[1], mix[2]])
lab = ["GREEN", "AMBER", "RED"]
for (o, p, why), v in sorted(diffs.items(), key=lambda x: -x[1])[:12]: print(f"  oracle {lab[o]:<5} -> pipeline {lab[p]:<5} {v:>5}  cause: {why}")
safe = sum(v for (o, p, w), v in diffs.items() if p > o); unsafe = sum(v for (o, p, w), v in diffs.items() if p < o)
print(f"disagreements: {safe} safer-than-md (pipeline higher), {unsafe} less-safe-than-md (pipeline lower)")
at_least_amber_o = sum(v for (o, p), v in conf.items() if o >= 1); caught = sum(v for (o, p), v in conf.items() if o >= 1 and p >= 1)
print(f"sensitivity for md AMBER-or-RED: {caught/at_least_amber_o:.4f}")
json.dump(dict(n=N, agreement=round(n_ok / N, 4), red_missed=red_miss, safer=safe, unsafe=unsafe, sens_amber_or_red=round(caught / at_least_amber_o, 4)), open("docs/oracle_results.json", "w"), indent=1)
