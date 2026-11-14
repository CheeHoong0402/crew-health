"""Fast AETHER demo/test harness. Usage: python3 -I run_demo.py <aether_project_dir>"""
import sys, json, time, csv, glob, os
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(ROOT)); os.chdir(ROOT)

import numpy as np
from PIL import Image
from jsonschema import Draft202012Validator, Draft7Validator, validators
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

from engine import tier2_risk_engine as t2
from engine.tier1_hbm_physics import TelemetryInput
from engine.tier3_5_multimodal_rag import build_local_bootstrap_index

results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")

# ---- Tier 2 surrogate (LightGBM/ONNX/SHAP unavailable offline) -------------------
X, y = t2._load_telemetry_csv(t2.DEFAULT_DATASET_CSV)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=0, stratify=y)
w = np.where(ytr == 2, 10.0, 1.0)  # same 10x CRITICAL_RED penalty as the plan
t0 = time.time()
clf = HistGradientBoostingClassifier(max_iter=120, random_state=0).fit(Xtr, ytr, sample_weight=w)
print(f"Tier2 surrogate trained on {len(Xtr)} rows in {time.time()-t0:.1f}s")
pred = clf.predict(Xte)
rep = classification_report(yte, pred, target_names=t2.ALERT_LABELS, output_dict=True, digits=3)
print(classification_report(yte, pred, target_names=t2.ALERT_LABELS, digits=3))
print("confusion (rows=true):\n", confusion_matrix(yte, pred))
red_recall = rep["CRITICAL_RED"]["recall"]
check("Tier2 CRITICAL_RED recall >= 0.95 (surrogate)", red_recall >= 0.95, f"recall={red_recall:.3f}")
check("Tier2 overall accuracy >= 0.90 (surrogate)", rep["accuracy"] >= 0.90, f"acc={rep['accuracy']:.3f}")

class SurrogateTier2:
    def predict(self, t, hbm=None):
        s = time.perf_counter()
        v = t2.extract_feature_vector(t, hbm)
        p = clf.predict_proba(v)[0]
        base = np.asarray([t2.NOMINAL_BASELINE[c] for c in t2.FEATURE_COLUMNS], dtype=np.float32)
        risk = lambda q: float(q[1] + 2.0 * q[2])
        r0 = risk(p); deltas = np.zeros(len(base))
        for i in range(len(base)):          # counterfactual ablation, as in the project's ONNX fallback
            if abs(float(v[0, i]) - float(base[i])) < 1e-4: continue
            vv = v.copy(); vv[0, i] = base[i]
            deltas[i] = max(0.0, r0 - risk(clf.predict_proba(vv)[0]))
        if deltas.sum() <= 1e-6:
            deltas = np.abs(v[0] - base) / np.maximum(1.0, np.abs(base))
        norm = deltas / (deltas.sum() or 1.0)
        top = [{"feature": t2.FEATURE_COLUMNS[int(i)], "value": round(float(v[0, int(i)]), 2),
                "impact_weight": round(float(norm[int(i)]), 3)} for i in np.argsort(-norm)[:3]]
        idx = int(np.argmax(p))
        return t2.Tier2Prediction(t2.ALERT_LABELS[idx],
            {k: round(float(p[i]), 4) for i, k in enumerate(t2.ALERT_LABELS)},
            top, round((time.perf_counter()-s)*1000, 3), "sklearn_surrogate_zscore")
t2.Tier2RiskEngine = SurrogateTier2

# ---- Tier 3.5 index + pipeline ---------------------------------------------------
idx = build_local_bootstrap_index()
check("Tier3.5 index builds", len(idx["protocols"]) > 0 and len(idx["scan_prototypes"]) > 0,
      f"{len(idx['protocols'])} protocols, {len(idx['scan_prototypes'])} scan classes")
from engine import pipeline as pl
pl.Tier2RiskEngine = SurrogateTier2
pipe = pl.AetherPipeline()
print("backends -> RAG:", pipe.rag.backend_name, "| Tier4:", pipe.tier4.backend)

schema = json.load(open(ROOT / "data/schema/triage_output.schema.json"))
validator = validators.validator_for(schema)(schema)

SCEN = {
 "nominal":        (dict(), {"NOMINAL_GREEN"}),
 "notebook_sample":(dict(goes_proton_flux_pfu=42.5, ltv_imu_peak_g=2.8, cabin_ppco2_mmhg=2.1,
                    symptom_notes="Solar proton alert during rover EVA jolt, left shoulder soreness.",
                    habitat_location="LTV Rover"), None),
 "SPE_storm":      (dict(goes_proton_flux_pfu=900.0, dosimeter_rate_usv_hr=4000.0,
                    symptom_notes="nausea and vomiting after solar storm"), {"CRITICAL_RED"}),
 "CO2_toxic":      (dict(cabin_ppco2_mmhg=9.0, symptom_notes="severe headache confusion"), {"CRITICAL_RED"}),
 "hypoxia":        (dict(cabin_o2_pct=14.0), {"CRITICAL_RED"}),
 "decompression":  (dict(cabin_pressure_kpa=55.0), {"CRITICAL_RED"}),
 "clavicle_impact":(dict(ltv_imu_peak_g=6.0, recent_suit_impacts_7d=6, suit_pressure_psi=4.3,
                    symptom_notes="sharp clavicle pain after fall"), None),
}
print("\n=== Scenario run ===")
lat = []; rows = []
for name, (kw, expect) in SCEN.items():
    s = time.perf_counter()
    out, d = pipe.run(TelemetryInput(**kw))
    wall = (time.perf_counter()-s)*1000; lat.append(wall)
    errs = list(validator.iter_errors(out))
    check(f"{name}: Section-6 JSON schema valid", not errs, errs[0].message[:90] if errs else "")
    check(f"{name}: Tier3 interlock < 5 ms", d.tier3_ms < 5, f"{d.tier3_ms} ms")
    if expect:
        check(f"{name}: interlock alert in {sorted(expect)}", d.tier3_interlock_alert in expect,
              f"got {d.tier3_interlock_alert}")
    rows.append((name, d.tier3_interlock_alert, d.tier2_predicted_label,
                 out.get("alert_level"), [m['id'] for m in d.rag_matches][:2], round(wall,1)))
    if name in ("notebook_sample", "SPE_storm"):
        print(f"\n--- {name} triage JSON ---\n{json.dumps(out, indent=1)[:1500]}")
# Safety rule: final alert may never be lower than the interlock
rank = {"NOMINAL_GREEN":0, "CAUTION_AMBER":1, "CRITICAL_RED":2}
bad = [r for r in rows if rank.get(r[3],0) < rank.get(r[1],0)]
check("Final alert never below Tier3 interlock", not bad, str(bad))
print("\n{:<16}{:<15}{:<15}{:<15}{}".format("scenario","tier3","tier2*","final","top RAG / wall ms"))
for r in rows: print("{:<16}{:<15}{:<15}{:<15}{} / {}".format(*r[:4], r[4], r[5]))

# ---- Tier 3.5 image scan matching ------------------------------------------------
imgs = sorted(glob.glob(str(ROOT / "data/generated/scan_images/*.png")))
ok = 0; tot = 0; miss = []
for p in imgs:
    true_cls = Path(p).stem.rsplit("_", 1)[0]
    m = pipe.rag.match_scan_image(Image.open(p).convert("RGB"))
    got = str(m.get("class") or m.get("scan_class") or m.get("label") or list(m.values())[0])
    tot += 1
    if true_cls in got or got in true_cls: ok += 1
    else: miss.append((Path(p).name, got))
if imgs: print("scan match sample:", m)
check("Scan matching top-1 accuracy >= 0.90", tot and ok/tot >= 0.90, f"{ok}/{tot}  misses={miss[:3]}")

# ---- Speed -----------------------------------------------------------------------
reps = []
for _ in range(50):
    s = time.perf_counter(); pipe.run(TelemetryInput()); reps.append((time.perf_counter()-s)*1000)
p50, p95 = np.percentile(reps, [50, 95])
check("Pipeline p95 latency < 100 ms", p95 < 100, f"p50={p50:.1f} ms p95={p95:.1f} ms")

n_pass = sum(r[1] for r in results)
print(f"\nSUMMARY: {n_pass}/{len(results)} checks passed")
json.dump([{"check": a, "pass": b, "detail": c} for a, b, c in results], open("docs/demo_results.json", "w"), indent=1)
