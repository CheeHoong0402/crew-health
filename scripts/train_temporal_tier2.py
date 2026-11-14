"""Train + evaluate the temporal early-warning Tier 2 on synthetic crew timelines (group-split by crew).
python3 -I scripts/train_temporal_tier2.py <project_dir>
Label: current interlock GREEN and interlock >= AMBER on any of the next 2 days. Gradual-onset syndromes are the design target;
sudden events (impact, flare with no precursor) are included as UNPREDICTABLE and reported separately.
"""
import sys, os, json, time, collections
from pathlib import Path
ROOT = Path(sys.argv[1]).resolve(); sys.path.insert(0, str(ROOT)); os.chdir(ROOT)
import numpy as np, joblib
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from engine.tier1_hbm_physics import TelemetryInput, compute_hbm_state
from engine.tier3_safety_interlock import evaluate_safety_interlock
from engine.tier2_temporal import window_features, KEY_FIELDS, FEATURE_NAMES, WINDOW

RANK = {"NOMINAL_GREEN": 0, "CAUTION_AMBER": 1, "CRITICAL_RED": 2}
DAYS = 50
rng0 = np.random.default_rng(2026)

def ramp(t, d0, L, a, b, hold=6, rec=3):
    """a -> b over L days starting d0, hold, then recover over rec days."""
    if t < d0: return a
    u = (t - d0) / max(L, 1)
    if u < 1: return a + (b - a) * u
    if t < d0 + L + hold: return b
    r = (t - d0 - L - hold) / rec
    return b + (a - b) * min(r, 1.0)

def simulate(seed):
    rng = np.random.default_rng(seed)
    T = DAYS; t = np.arange(T)
    hr0 = rng.uniform(56, 80); sbp0 = rng.uniform(106, 128); dbp0 = rng.uniform(68, 82); hrv0 = rng.uniform(30, 55)
    glu0 = rng.uniform(84, 104); temp0 = rng.uniform(36.6, 36.95); sleep0 = rng.uniform(6.6, 8.2); mood0 = rng.uniform(6.5, 8.8)
    co20 = rng.uniform(1.0, 2.2); ared0 = rng.uniform(0.82, 0.98); career0 = rng.choice([rng.uniform(40, 300), rng.uniform(470, 504)], p=[0.85, 0.15])
    mass0 = 0.0
    ch = dict(hr=np.full(T, hr0), sbp=np.full(T, sbp0), dbp=np.full(T, dbp0), hrv=np.full(T, hrv0), glu=np.full(T, glu0),
              temp=np.full(T, temp0), mass=np.full(T, 70.0), sleep=np.full(T, sleep0), mood=np.full(T, mood0), co2=np.full(T, co20),
              flux=np.full(T, 0.5), dust=np.full(T, 0.02), ared=np.full(T, ared0), jolt=np.full(T, 0.4), o2=np.full(T, 21.0),
              press=np.full(T, 101.3), dose=np.full(T, 25.0), career=career0 + 0.55 * t)
    events = []
    for _ in range(rng.choice([0, 1, 1, 2, 2])):
        fam = rng.choice(["ars", "ortho", "co2", "sleep", "infect", "dust", "gluc", "career", "bone", "spe_sudden", "impact_sudden"],
                         p=[.11, .11, .12, .10, .10, .08, .07, .07, .07, .09, .08])
        d0 = int(rng.integers(10, T - 14)); L = int(rng.integers(3, 8)); g = fam not in ("spe_sudden", "impact_sudden")
        U = rng.uniform
        if fam == "ars":
            pk = U(14, 60); L = int(rng.integers(2, 5)); tp = U(1.2, 2.2); hp = hr0 * U(0.22, 0.38); dp = U(120, 600)
            ch["flux"] = np.array([0.5 * (pk / 0.5) ** min(max((x - d0) / L, 0), 1) if d0 <= x < d0 + L + 5 else 0.5 for x in t])
            ch["temp"] = ch["temp"] + np.array([ramp(x, d0, L, 0, tp) for x in t]); ch["hr"] = ch["hr"] + np.array([ramp(x, d0, L, 0, hp) for x in t])
            ch["mood"] = ch["mood"] - np.array([ramp(x, d0, L, 0, 3.0) for x in t]); ch["dose"] = np.array([25 + ramp(x, d0, L, 0, dp) for x in t])
        elif fam == "ortho":
            mp, sp, hp = -U(2.0, 3.6), U(22, 38), U(34, 55)
            ch["mass"] = ch["mass"] + np.array([ramp(x, d0, L, 0, mp) for x in t]); ch["sbp"] = ch["sbp"] - np.array([ramp(x, d0, L, 0, sp) for x in t])
            ch["hr"] = ch["hr"] + np.array([ramp(x, d0, L, 0, hp) for x in t])
        elif fam == "co2":
            L = int(rng.integers(6, 13)); pk, dp, sp = U(3.1, 4.3), U(7, 14), U(0.5, 1.6)
            ch["co2"] = np.array([ramp(x, d0, L, co20, pk, hold=8) for x in t]); ch["dbp"] = ch["dbp"] + np.array([ramp(x, d0, L, 0, dp) for x in t])
            ch["sleep"] = ch["sleep"] - np.array([ramp(x, d0, L, 0, sp) for x in t])
        elif fam == "sleep":
            L = int(rng.integers(4, 9)); sp, mp = U(3.8, 5.2), U(2.0, 4.0)
            ch["sleep"] = np.array([ramp(x, d0, L, sleep0, sp, hold=8) for x in t]); ch["mood"] = np.array([ramp(x, d0, L, mood0, mp, hold=8) for x in t])
        elif fam == "infect":
            L = int(rng.integers(3, 7)); tp, hp = U(38.6, 39.6), U(15, 40)
            ch["temp"] = np.array([ramp(x, d0, L, temp0, tp, hold=5) for x in t]); ch["hr"] = ch["hr"] + np.array([ramp(x, d0, L, 0, hp) for x in t])
        elif fam == "dust":
            L = int(rng.integers(3, 7)); pk = U(0.36, 0.9); ch["dust"] = np.array([ramp(x, d0, L, 0.02, pk, hold=5) for x in t])
        elif fam == "gluc":
            L = int(rng.integers(2, 5)); pk = U(50, 66); ch["glu"] = np.array([ramp(x, d0, L, glu0, pk, hold=3) for x in t])
        elif fam == "career":
            ch["career"] = career0 + U(1.2, 2.5) * t
        elif fam == "bone":
            L = int(rng.integers(6, 12)); pk = U(0.45, 0.75); ch["ared"] = np.array([ramp(x, d0, L, ared0, pk, hold=14) for x in t])
        elif fam == "spe_sudden":
            ch["flux"] = np.array([U(15, 400) if d0 <= x < d0 + 3 else 0.5 for x in t])
        elif fam == "impact_sudden":
            ch["jolt"] = np.array([U(2.7, 6.0) if x == d0 else 0.4 for x in t])
        events.append((str(fam), d0, g))
    # decoys + noise: transient 1-3 day excursions that mostly do NOT cross thresholds, and daily noise
    for _ in range(rng.integers(1, 4)):
        d0 = int(rng.integers(8, T - 4)); w = int(rng.integers(1, 4)); k = rng.choice(["hr", "sbp", "temp", "sleep", "glu", "co2"])
        mag = {"hr": rng.uniform(8, 22), "sbp": rng.uniform(-14, 18), "temp": rng.uniform(0.2, 0.7), "sleep": -rng.uniform(0.8, 1.8), "glu": rng.uniform(-12, 40), "co2": rng.uniform(0.2, 0.8)}[k]
        ch[k][d0:d0 + w] += mag
    ch["hr"] += rng.normal(0, 2.0, T); ch["sbp"] += rng.normal(0, 3.5, T); ch["dbp"] += rng.normal(0, 2.5, T); ch["hrv"] += rng.normal(0, 3, T)
    ch["glu"] += rng.normal(0, 4, T); ch["temp"] += rng.normal(0, 0.12, T); ch["sleep"] += rng.normal(0, 0.45, T); ch["mood"] += rng.normal(0, 0.55, T)
    ch["co2"] += rng.normal(0, 0.1, T); ch["mass"] += rng.normal(0, 0.18, T); ch["ared"] = np.clip(ch["ared"] + rng.normal(0, 0.015, T), 0, 1)
    ch["dust"] = np.abs(ch["dust"] + rng.normal(0, 0.006, T)); ch["flux"] = np.abs(ch["flux"] * rng.lognormal(0, 0.12, T)); ch["o2"] += rng.normal(0, 0.12, T)
    ch["press"] += rng.normal(0, 0.25, T); ch["dose"] = np.abs(ch["dose"] + rng.normal(0, 3, T))
    hist, lv = [], []
    for d in range(T):
        prev7 = ch["hr"][max(0, d - 7):d]; hr_delta = 0.0 if len(prev7) == 0 else (ch["hr"][d] - prev7.mean()) / prev7.mean() * 100
        t_ = TelemetryInput(resting_hr_bpm=float(ch["hr"][d]), hr_baseline_7d_delta_pct=float(hr_delta), systolic_bp_mmhg=float(ch["sbp"][d]), diastolic_bp_mmhg=float(ch["dbp"][d]),
            hrv_rmssd_ms=float(ch["hrv"][d]), blood_glucose_mg_dl=float(ch["glu"][d]), core_temp_c=float(ch["temp"][d]), mass_change_48h_kg=float(ch["mass"][d] - ch["mass"][max(0, d - 2)]),
            sleep_hours_3d_avg=float(ch["sleep"][d]), mood_score_1_10=float(np.clip(ch["mood"][d], 1, 10)), mission_elapsed_days=float(30 + d), ared_compliance_14d=float(ch["ared"][d]),
            ltv_imu_peak_g=float(ch["jolt"][d]), goes_proton_flux_pfu=float(ch["flux"][d]), dosimeter_rate_usv_hr=float(ch["dose"][d]), cumulative_career_msv=float(ch["career"][d]),
            cabin_ppco2_mmhg=float(ch["co2"][d]), cabin_o2_pct=float(ch["o2"][d]), cabin_pressure_kpa=float(ch["press"][d]), airborne_dust_mg_m3=float(ch["dust"][d]))
        hist.append(t_); lv.append(RANK[evaluate_safety_interlock(t_, compute_hbm_state(t_)).alert_level])
    return hist, np.array(lv), events

def build(seeds):
    X, y, g, fam_row, days, cross = [], [], [], [], [], {}
    for s in seeds:
        hist, lv, ev = simulate(int(s)); T = len(hist)
        nz = np.where(lv >= 1)[0]; c = int(nz[0]) if len(nz) else None
        cf = [f for (f, d0, gr) in ev if c is not None and d0 <= c]
        cross[int(s)] = (c, cf[-1] if cf else ("decoy_or_noise" if c is not None else None))
        for d in range(WINDOW - 1, T - 2):
            if lv[d] != 0: continue
            lab = int(lv[d + 1:d + 3].max() >= 1)
            X.append(window_features(hist[:d + 1])[0]); y.append(lab); g.append(s); days.append(d)
            near = [f for (f, d0, gr) in ev if d0 <= d + 2 and d <= d0 + 20]
            fam_row.append(near[-1] if near else "none")
    return np.array(X), np.array(y), np.array(g), np.array(fam_row), np.array(days), cross

t0 = time.time()
seeds = rng0.integers(0, 2**31 - 1, size=1500)
Xa, ya, ga, fa, da, CROSS = build(seeds)
print(f"built {len(ya)} rows from {len(seeds)} crew timelines in {time.time()-t0:.0f}s; positive rate {ya.mean():.3f}")
crews = np.unique(ga); rng0.shuffle(crews); n = len(crews)
split = {"tr": set(crews[: int(.7 * n)]), "va": set(crews[int(.7 * n): int(.85 * n)]), "te": set(crews[int(.85 * n):])}
m = {k: np.array([c in v for c in ga]) for k, v in split.items()}
snap_idx = [i for i, nme in enumerate(FEATURE_NAMES) if nme.endswith("__cur")]
res = {}
def evaluate(name, cols):
    clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=31, l2_regularization=1.0, random_state=0, early_stopping=True,
                                         class_weight={0: 1.0, 1: 3.0}).fit(Xa[m["tr"]][:, cols], ya[m["tr"]])
    pv = clf.predict_proba(Xa[m["va"]][:, cols])[:, 1]; yv = ya[m["va"]]
    thr = float(np.quantile(pv[yv == 0], 0.90))                        # threshold from VAL: 10% false-alarm rate
    pt = clf.predict_proba(Xa[m["te"]][:, cols])[:, 1]; yt = ya[m["te"]]; hit = pt >= thr
    out = dict(auroc=round(float(roc_auc_score(yt, pt)), 4), recall=round(float(hit[yt == 1].mean()), 4), false_alarm_rate=round(float(hit[yt == 0].mean()), 4),
               precision=round(float(yt[hit].mean()), 4), thr=round(thr, 4), n_test=int(len(yt)), pos_rate=round(float(yt.mean()), 4))
    fam = {}
    for f in sorted(set(fa[m["te"]])):
        k = (fa[m["te"]] == f) & (yt == 1)
        if k.sum() >= 15: fam[f] = (round(float(hit[k].mean()), 3), int(k.sum()))
    out["recall_by_family"] = fam
    # operating points chosen on VAL false-alarm quantiles
    ops = {}
    for fa_t in (0.01, 0.02, 0.05, 0.10):
        th = float(np.quantile(pv[yv == 0], 1 - fa_t)); h2 = pt >= th
        gs, ds = ga[m["te"]], da[m["te"]]; det = collections.defaultdict(list); alarms_nocross = []
        for sd in sorted(set(gs)):
            c, cfam = CROSS[int(sd)]; k = gs == sd
            if c is None:
                alarms_nocross.append(float(h2[k].sum()) * 30.0 / max(k.sum(), 1)); continue
            w = k & (ds >= c - 3) & (ds <= c - 1)
            if w.sum(): det[cfam].append(bool(h2[w].any()))
        evr = {f: (round(float(np.mean(v)), 3), len(v)) for f, v in det.items() if len(v) >= 8}
        gradf = [f for f in evr if f not in ("spe_sudden", "impact_sudden", "decoy_or_noise")]
        ops[str(fa_t)] = dict(row_recall=round(float(h2[yt == 1].mean()), 3), false_alarms_per_30d_healthy_crew=round(float(np.mean(alarms_nocross)), 2),
                              event_recall_by_family=evr, event_recall_gradual_mean=round(float(np.mean([evr[f][0] for f in gradf])), 3) if gradf else None)
    out["operating_points"] = ops
    res[name] = (clf, thr, out); return out
A = evaluate("snapshot_only", snap_idx); B = evaluate("temporal", list(range(len(FEATURE_NAMES))))
for k, o in (("snapshot-only (no trends)", A), ("TEMPORAL (7-day windows)", B)):
    print(f"\n{k}: AUROC={o['auroc']}  recall@10%FA={o['recall']}  false-alarm={o['false_alarm_rate']}  precision={o['precision']}  (test rows {o['n_test']}, pos {o['pos_rate']})")
    print("   recall by family:", o["recall_by_family"])
grad = [f for f in B["recall_by_family"] if f not in ("spe_sudden", "impact_sudden", "none")]
gr = np.mean([B["recall_by_family"][f][0] for f in grad]) if grad else float("nan")
print(f"\nmean per-row recall over gradual-onset families: {gr:.3f}")
print("\nEVENT-LEVEL detection (alarm in the 3 days before first interlock crossing) at operating points chosen on val:")
for fa_t, o in B["operating_points"].items():
    print(f"  daily FA {float(fa_t):.0%}: gradual-event recall={o['event_recall_gradual_mean']}  false alarms/30d per healthy crew={o['false_alarms_per_30d_healthy_crew']}  row recall={o['row_recall']}")
    print("     ", {k: v[0] for k, v in o["event_recall_by_family"].items()})
clf, thr, _ = res["temporal"]
joblib.dump({"model": clf, "threshold": thr, "feature_names": list(FEATURE_NAMES), "ref_mean": Xa[m["tr"]].mean(0), "ref_std": Xa[m["tr"]].std(0)}, ROOT / "artifacts" / "tier2_temporal.joblib")
# speed
sample = simulate(7)[0][:20]; from engine.tier2_temporal import TemporalEarlyWarning
ew = TemporalEarlyWarning(); lat = []
for _ in range(300):
    s = time.perf_counter(); ew.predict(sample); lat.append((time.perf_counter() - s) * 1e3)
print(f"inference p50={np.percentile(lat,50):.2f} ms p95={np.percentile(lat,95):.2f} ms")
json.dump({"snapshot_only": A, "temporal": B, "gradual_mean_recall": round(float(gr), 4), "latency_ms_p95": round(float(np.percentile(lat, 95)), 2)},
          open(ROOT / "docs" / "temporal_results.json", "w"), indent=1)
