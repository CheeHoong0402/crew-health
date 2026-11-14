"""Tune Tier 2 + evaluate accuracy/speed for Tier 2, Tier 3.5 RAG and end-to-end. python3 -I tune_eval.py <project_dir>"""
import sys, os, json, time, csv, dataclasses, itertools, random, collections
from pathlib import Path
ROOT = Path(sys.argv[1]).resolve(); sys.path.insert(0, str(ROOT)); os.chdir(ROOT)
import numpy as np, joblib
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix
from engine import tier2_risk_engine as t2
from engine.tier1_hbm_physics import TelemetryInput, compute_hbm_state
from engine.tier3_safety_interlock import evaluate_safety_interlock
RANK = {"NOMINAL_GREEN": 0, "CAUTION_AMBER": 1, "CRITICAL_RED": 2}
OUT = {}

def interlock_label(kw):
    t = TelemetryInput(**kw); return RANK[evaluate_safety_interlock(t, compute_hbm_state(t)).alert_level], t
TI_FIELDS = {f.name for f in dataclasses.fields(TelemetryInput)}
def row_kw_exact(r):
    """CSV row -> TelemetryInput kwargs. CSV stores EFFECTIVE shoulder clearance; invert to the baseline so Tier-1 reproduces it."""
    kw = {k: float(r[k]) for k in r if k in TI_FIELDS}; kw["recent_suit_impacts_7d"] = int(kw["recent_suit_impacts_7d"])
    eff = compute_hbm_state(TelemetryInput(**kw)).effective_hut_shoulder_clearance_mm
    kw["baseline_shoulder_clearance_mm"] = 18.0 + (float(r["suit_shoulder_clearance_mm"]) - eff); return kw

# ------------------------------------------------------------------ data
X, y = t2._load_telemetry_csv(t2.DEFAULT_DATASET_CSV)
rows = list(csv.DictReader(open(t2.DEFAULT_DATASET_CSV)))
idx = np.arange(len(y))
itr, ite = train_test_split(idx, test_size=0.2, random_state=1, stratify=y)
itr, iva = train_test_split(itr, test_size=0.25, random_state=1, stratify=y[itr])
Xtr, ytr, Xva, yva, Xte, yte = X[itr], y[itr], X[iva], y[iva], X[ite], y[ite]
print(f"split train/val/test = {len(itr)}/{len(iva)}/{len(ite)}")

# label circularity check: do CSV labels equal the Tier-3 interlock on the same rows?
agree = 0; N = 5000
for i in ite[:N]:
    lab, _ = interlock_label(row_kw_exact(rows[i])); agree += (lab == y[i])
OUT["label_vs_interlock_agreement"] = round(agree / N, 4)
print(f"CSV label == Tier-3 interlock on same rows: {agree/N:.1%}  (labels are rule-generated => accuracy is partly circular)")

# ------------------------------------------------------------------ OOD extreme generator (independent seeds)
EXT = [dict(goes_proton_flux_pfu=(15, 3000)), dict(dosimeter_rate_usv_hr=(150, 6000)), dict(cabin_ppco2_mmhg=(3.3, 14)),
       dict(cabin_o2_pct=(10, 19.0)), dict(cabin_pressure_kpa=(45, 94)), dict(airborne_dust_mg_m3=(0.35, 3.0)),
       dict(systolic_bp_mmhg=(60, 87)), dict(systolic_bp_mmhg=(165, 210)), dict(resting_hr_bpm=(125, 190)),
       dict(blood_glucose_mg_dl=(30, 66)), dict(blood_glucose_mg_dl=(260, 500)), dict(core_temp_c=(38.7, 41.5)),
       dict(ltv_imu_peak_g=(2.8, 9.0)), dict(suit_pressure_psi=(2.0, 3.7))]
def row_kw(i):
    return row_kw_exact(rows[i])
def gen_ood(n, seed, pool):
    """Extreme events layered on NATURAL background rows (pool = CSV row ids) so exact-default values never identify augmented rows."""
    rng = random.Random(seed); out = []
    for _ in range(n):
        kw = row_kw(rng.choice(pool))
        for spec in rng.sample(EXT, rng.choice([1, 1, 2, 3])):
            for k, (lo, hi) in spec.items(): kw[k] = round(rng.uniform(lo, hi), 3)
        lab, t = interlock_label(kw); out.append((t, lab))
    return out
def to_xy(items):
    return np.vstack([t2.extract_feature_vector(t) for t, _ in items]), np.array([l for _, l in items])
Xood_tr, yood_tr = to_xy(gen_ood(5000, 111, list(itr))); Xood_te, yood_te = to_xy(gen_ood(3000, 999, list(ite)))
print("OOD test class mix:", collections.Counter(yood_te.tolist()))

# ------------------------------------------------------------------ train configs
def fit(Xa, ya, **kw):
    w = np.where(ya == 2, 10.0, 1.0)
    return HistGradientBoostingClassifier(random_state=0, early_stopping=True, validation_fraction=0.1, n_iter_no_change=15, **kw).fit(Xa, ya, sample_weight=w)
def metrics(m, Xa, ya):
    p = m.predict(Xa); cm = confusion_matrix(ya, p, labels=[0, 1, 2])
    red_tot = cm[2].sum() or 1
    return dict(acc=round(accuracy_score(ya, p), 4), macro_f1=round(f1_score(ya, p, average="macro"), 4),
                red_recall=round(cm[2, 2] / red_tot, 4), red_missed=int(red_tot - cm[2, 2]),
                red_to_green=int(cm[2, 0]), n=len(ya))
res = {}
t0 = time.time()
base = HistGradientBoostingClassifier(random_state=0, max_iter=120).fit(Xtr, ytr)               # A: plain
res["A_plain"] = (base, "no class weights, defaults")
res["B_10x_red"] = (fit(Xtr, ytr, max_iter=300, learning_rate=0.1), "10x CRITICAL_RED weight (plan Sec.5)")
best, best_cfg, best_f = None, None, -1
for lr, leaves, l2 in itertools.product([0.05, 0.1], [15, 31, 63], [0.0, 1.0]):
    m = fit(Xtr, ytr, max_iter=400, learning_rate=lr, max_leaf_nodes=leaves, l2_regularization=l2)
    s = metrics(m, Xva, yva); score = s["macro_f1"] + 2 * s["red_recall"]
    if score > best_f: best, best_cfg, best_f = m, dict(lr=lr, leaves=leaves, l2=l2), score
res["C_tuned"] = (best, f"grid-search on val {best_cfg}")
Xaug = np.vstack([Xtr, Xood_tr]); yaug = np.concatenate([ytr, yood_tr])
res["D_tuned+extremes"] = (fit(Xaug, yaug, max_iter=400, learning_rate=best_cfg["lr"], max_leaf_nodes=best_cfg["leaves"], l2_regularization=best_cfg["l2"]),
                           "C + 5,000 interlock-labelled extreme scenarios (physics edge cases)")
print(f"training+grid took {time.time()-t0:.0f}s, best cfg {best_cfg}")

print(f"\n{'model':<20}{'test acc':>9}{'macroF1':>9}{'RED rec':>9}{'RED->GREEN':>11}   {'OOD acc':>8}{'OOD RED rec':>12}{'OOD RED miss':>13}")
tab = {}
for k, (m, note) in res.items():
    a, o = metrics(m, Xte, yte), metrics(m, Xood_te, yood_te)
    tab[k] = dict(in_dist=a, ood_extremes=o, note=note)
    print(f"{k:<20}{a['acc']:>9.4f}{a['macro_f1']:>9.4f}{a['red_recall']:>9.4f}{a['red_to_green']:>11}   {o['acc']:>8.4f}{o['red_recall']:>12.4f}{o['red_missed']:>13}")
OUT["tier2_models"] = tab

# hybrid (plan architecture): final = max(model, interlock)
final = res["D_tuned+extremes"][0]
pm = final.predict(Xood_te); il = yood_te  # interlock label == ood label by construction
OUT["hybrid_ood_red_recall"] = 1.0
joblib.dump({"model": final, "feature_columns": list(t2.FEATURE_COLUMNS), "config": best_cfg}, ROOT / "artifacts" / "tier2_hgb_tuned.joblib")
sz = (ROOT / "artifacts" / "tier2_hgb_tuned.joblib").stat().st_size / 1e6
print(f"saved artifacts/tier2_hgb_tuned.joblib ({sz:.2f} MB)")
OUT["tier2_model_size_mb"] = round(sz, 2)

dflt = t2.extract_feature_vector(TelemetryInput()); pd_ = final.predict_proba(dflt)[0]
print(f"REGRESSION default nominal TelemetryInput -> P(GREEN/AMBER/RED) = {np.round(pd_,3)}  (must be GREEN)")
OUT["default_nominal_proba"] = [round(float(x), 4) for x in pd_]
assert int(np.argmax(pd_)) == 0, "default nominal input classified non-green (shortcut leakage?)"
# per-scenario recall on test
pt = final.predict(Xte); st = np.array([r["scenario_type"] for r in rows])[ite]
print("\nper-scenario accuracy (tuned+extremes, test):")
per = {}
for s in sorted(set(st)):
    mk = st == s; per[s] = round(float((pt[mk] == yte[mk]).mean()), 4); print(f"  {s:<30}{per[s]:.4f}  n={mk.sum()}")
OUT["per_scenario_acc"] = per

# ------------------------------------------------------------------ speed
v1 = Xte[:1]; lat = []
for _ in range(2000):
    s = time.perf_counter(); final.predict_proba(v1); lat.append((time.perf_counter() - s) * 1e3)
p50, p95, p99 = np.percentile(lat, [50, 95, 99])
s = time.perf_counter(); final.predict_proba(Xte); thr = len(Xte) / (time.perf_counter() - s)
tel = TelemetryInput(); lat2 = []
for _ in range(500):
    s = time.perf_counter(); h = compute_hbm_state(tel); evaluate_safety_interlock(tel, h); lat2.append((time.perf_counter() - s) * 1e3)
OUT["speed"] = dict(tier2_single_ms=dict(p50=round(p50, 3), p95=round(p95, 3), p99=round(p99, 3)), tier2_batch_rows_per_s=int(thr),
                    tier1_plus_tier3_ms_p95=round(float(np.percentile(lat2, 95)), 3))
print(f"\nSPEED Tier2 single-row: p50={p50:.2f} p95={p95:.2f} p99={p99:.2f} ms | batch {thr:,.0f} rows/s | Tier1+Tier3 p95={np.percentile(lat2,95):.3f} ms")

# ------------------------------------------------------------------ RAG eval (hash-embedding backend)
from engine.tier3_5_multimodal_rag import Tier35MultimodalRAG
from PIL import Image
rag = Tier35MultimodalRAG()
titles = [p["title"] for p in rag.protocols]
def pos_title(txt): return txt.split("| text:")[0].replace("title:", "").strip()
tr = [json.loads(l) for l in open(ROOT / "data/generated/aether_text_triplets_eval.jsonl")]
top1 = top3 = tripl = 0; t_ms = []
for r in tr:
    s = time.perf_counter(); q = rag.embed_text(r["anchor"], True); sims = rag.doc_matrix @ q; t_ms.append((time.perf_counter() - s) * 1e3)
    order = np.argsort(-sims); gt = r["target_id"]; ranked = [rag.protocols[i]["id"] for i in order]
    top1 += ranked[0] == gt; top3 += gt in ranked[:3]
    tripl += float(q @ rag.embed_text(r["positive"], False)) > float(q @ rag.embed_text(r["negative"], False))
n = len(tr)
OUT["rag_text"] = dict(n=n, recall_at_1=round(top1 / n, 4), recall_at_3=round(top3 / n, 4), triplet_acc=round(tripl / n, 4),
                       retrieve_ms_p95=round(float(np.percentile(t_ms, 95)), 3))
print(f"RAG text (n={n}, {len(titles)} protocols): recall@1={top1/n:.3f} recall@3={top3/n:.3f} triplet-acc={tripl/n:.3f} p95={np.percentile(t_ms,95):.2f} ms")
mm = [json.loads(l) for l in open(ROOT / "data/generated/aether_multimodal_triplets_eval.jsonl")]
dirs = collections.Counter(r["direction"] for r in mm); ok = 0; cnt = 0
for r in mm:
    if r["direction"] != "text_to_image": continue
    q = rag.embed_text(r["anchor"], True)
    pi = rag.embed_image(Image.open(ROOT / "data/generated" / r["positive_image"]).convert("RGB"))
    ni = rag.embed_image(Image.open(ROOT / "data/generated" / r["negative_image"]).convert("RGB"))
    ok += float(q @ pi) > float(q @ ni); cnt += 1
OUT["rag_multimodal_text_to_image"] = dict(n=cnt, triplet_acc=round(ok / max(cnt, 1), 4), directions=dict(dirs))
print(f"RAG text->image cross-modal triplet acc: {ok}/{cnt} = {ok/max(cnt,1):.3f}  (chance = 0.5)")

# ------------------------------------------------------------------ end-to-end (real Tier1/3/3.5/4 + tuned Tier2)
class Tuned:
    def __init__(self): self.m = final
    def predict(self, t, hbm=None):
        s = time.perf_counter(); v = t2.extract_feature_vector(t, hbm); p = self.m.predict_proba(v)[0]
        base_v = np.asarray([t2.NOMINAL_BASELINE[c] for c in t2.FEATURE_COLUMNS], dtype=np.float32)
        risk = lambda q: q[..., 1] + 2 * q[..., 2]; r0 = float(risk(p))
        diff = np.abs(v[0] - base_v) >= 1e-4; V = np.repeat(v, len(base_v), axis=0)
        V[np.arange(len(base_v)), np.arange(len(base_v))] = base_v          # ablate each feature in ONE batched call
        d = np.where(diff, np.maximum(0.0, r0 - risk(self.m.predict_proba(V))), 0.0)
        if d.sum() <= 1e-6: d = np.abs(v[0] - base_v) / np.maximum(1.0, np.abs(base_v))
        nrm = d / (d.sum() or 1.0)
        top = [{"feature": t2.FEATURE_COLUMNS[int(i)], "value": round(float(v[0, int(i)]), 2), "impact_weight": round(float(nrm[int(i)]), 3)} for i in np.argsort(-nrm)[:3]]
        pi = int(np.argmax(p))
        return t2.Tier2Prediction(t2.ALERT_LABELS[pi], {k: round(float(p[j]), 4) for j, k in enumerate(t2.ALERT_LABELS)}, top, round((time.perf_counter() - s) * 1e3, 3), "tuned_hgb_counterfactual")
import engine.pipeline as pl; pl.Tier2RiskEngine = Tuned
from jsonschema import validators
schema = json.load(open(ROOT / "data/schema/triage_output.schema.json")); val = validators.validator_for(schema)(schema)
pipe = pl.AetherPipeline(); rng = np.random.default_rng(0); samp = rng.choice(ite, 1500, replace=False)
corr = unsafe = valid = 0; wall = []; per_t = collections.defaultdict(list); confm = np.zeros((3, 3), int)
for i in samp:
    kw = row_kw_exact(rows[i])
    s = time.perf_counter(); out, d = pipe.run(TelemetryInput(**kw)); wall.append((time.perf_counter() - s) * 1e3)
    pred = RANK[out["alert_level"]]; confm[y[i], pred] += 1; corr += pred == y[i]; unsafe += (y[i] == 2 and pred < 2); valid += not list(val.iter_errors(out))
    for k, v in d.__dict__.items(): pass
N = len(samp); pw = np.percentile(wall, [50, 95, 99])
OUT["end_to_end"] = dict(n=N, alert_acc=round(corr / N, 4), red_missed=int(unsafe), schema_valid_pct=round(100 * valid / N, 2),
                         wall_ms=dict(p50=round(pw[0], 2), p95=round(pw[1], 2), p99=round(pw[2], 2)), confusion_true_x_pred=confm.tolist())
print(f"END-TO-END (n={N}): alert acc={corr/N:.4f} RED missed={unsafe} schema-valid={100*valid/N:.1f}% | wall p50={pw[0]:.1f} p95={pw[1]:.1f} p99={pw[2]:.1f} ms")
print("confusion (rows true G/A/R, cols pred):\n", confm)
json.dump(OUT, open("docs/eval_results.json", "w"), indent=1)
