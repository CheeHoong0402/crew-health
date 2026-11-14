"""Train + evaluate Tier 3.5 trained retrievers (text -> protocol, scan image -> finding) without GPU/PyTorch.
Usage: python3 -I scripts/train_retrievers.py <project_dir>
Text: TF-IDF(word 1-2 + char 3-5) + LogisticRegression on triplet anchors. Eval anchors use 20 base phrasings never seen in train.
Image: signature(256) + 24x24 thumbnail -> standardized LogisticRegression; train images 00-11, TEST images 12-17 (no leakage).
"""
import sys, os, json, re, time, collections
from pathlib import Path
ROOT = Path(sys.argv[1]).resolve(); sys.path.insert(0, str(ROOT)); os.chdir(ROOT)
import numpy as np, joblib
from PIL import Image
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import GroupKFold
from engine.tier3_5_multimodal_rag import compute_image_signature_256d

G = ROOT / "data" / "generated"; ART = ROOT / "artifacts"; ART.mkdir(exist_ok=True)
rd = lambda f: [json.loads(l) for l in open(G / f)]
tr, ev = rd("aether_text_triplets_train.jsonl"), rd("aether_text_triplets_eval.jsonl")
protos = [json.loads(l) for l in open(ROOT / "data/nasa_protocols.jsonl") if l.strip()]
pids = [p["id"] for p in protos]; OUT = {}

# ---------------------------------------------------------------- text retriever
base = lambda a: re.sub(r"\s*\(station:.*\)$", "", a)
extra = [json.loads(l) for l in open(ROOT / "data" / "extra_anchor_phrasings.jsonl")]   # hand-written, independent of eval set
Xt = [r["anchor"] for r in tr] + [p["document_text"] for p in protos] + [r["anchor"] for r in extra]
yt = [r["target_id"] for r in tr] + pids + [r["target_id"] for r in extra]
groups = [base(r["anchor"]) for r in tr] + [f"doc{i}" for i in range(len(protos))] + [f"x{i}" for i in range(len(extra))]
SW = np.array([1.0] * len(tr) + [1.0] * len(protos) + [8.0] * len(extra))   # hand-written phrasings are rare but diverse -> upweight

def make(C):
    return make_pipeline_text(C)
from engine.trained_retriever import TextClf, image_features
# choose C by GroupKFold on base phrase (phrase-held-out CV inside TRAIN only)
best = (None, -1)
for C in (2.0, 10.0, 50.0):
    accs = []
    for a, b in GroupKFold(4).split(Xt, yt, groups):
        m = TextClf(C).fit([Xt[i] for i in a], [yt[i] for i in a], SW[a])
        pr = m.classes_[m.predict_proba([Xt[i] for i in b]).argmax(1)]
        accs.append(np.mean(pr == np.array([yt[i] for i in b])))
    print(f"text clf C={C}: phrase-held-out CV acc={np.mean(accs):.4f}")
    if np.mean(accs) > best[1]: best = (C, np.mean(accs))
clf = TextClf(best[0]).fit(Xt, yt, SW)
P = clf.predict_proba([r["anchor"] for r in ev]); yev = np.array([r["target_id"] for r in ev])
order = np.argsort(-P, 1); cls = clf.classes_
r1 = np.mean(cls[order[:, 0]] == yev); r3 = np.mean([yev[i] in cls[order[i, :3]] for i in range(len(yev))])
t0 = time.perf_counter(); [clf.predict_proba([a]) for a in [r["anchor"] for r in ev[:200]]]; ms = (time.perf_counter() - t0) / 200 * 1e3
print(f"TEXT retriever on held-out eval (n={len(ev)}): recall@1={r1:.4f} recall@3={r3:.4f}  {ms:.2f} ms/query  (baseline hash-embedding: 0.569 / 0.800)")
OUT["text"] = dict(n=len(ev), recall_at_1=round(float(r1), 4), recall_at_3=round(float(r3), 4), cv_phrase_heldout=round(best[1], 4), ms_per_query=round(ms, 2), C=best[0])
joblib.dump({"model": clf, "classes": list(cls)}, ART / "rag_text_clf.joblib")

# ---------------------------------------------------------------- image classifier (leakage-free split)
KIND2PID = {"ocular_fundus_sans": "PROTO-SANS-01", "ocular_fundus_normal": "PROTO-NOM-01", "skin_erythema_radiation": "PROTO-SPE-01", "skin_normal": "PROTO-NOM-01",
            "thoracic_ultrasound_pneumothorax": "PROTO-ECLSS-01", "thoracic_ultrasound_normal": "PROTO-NOM-01", "bone_clavicle_fracture": "PROTO-SUIT-01", "bone_clavicle_intact": "PROTO-NOM-01"}
feat = image_features
Xi, yi, idxs = [], [], []
for p in sorted((G / "scan_images").glob("*.png")):
    kind, n = p.stem.rsplit("_", 1); Xi.append(feat(Image.open(p))); yi.append(kind); idxs.append(int(n))
Xi, yi, idxs = np.array(Xi), np.array(yi), np.array(idxs)
trm, tem = idxs <= 11, idxs >= 12
img = make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=3000)).fit(Xi[trm], yi[trm])
pred = img.predict(Xi[tem]); acc8 = np.mean(pred == yi[tem])
ab = lambda k: 0 if k.endswith(("normal", "intact")) else 1
acc2 = np.mean([ab(a) == ab(b) for a, b in zip(pred, yi[tem])])
# baseline: nearest prototype on the same held-out images (prototypes built from 00-11)
cent = {k: np.mean([x[:256] for x in Xi[trm][yi[trm] == k]], 0) for k in set(yi)}
cent = {k: v / np.linalg.norm(v) for k, v in cent.items()}
base_pred = [max(cent, key=lambda k: float(cent[k] @ (x[:256] / np.linalg.norm(x[:256])))) for x in Xi[tem]]
base_acc = np.mean(np.array(base_pred) == yi[tem])
print(f"IMAGE classifier on UNSEEN images 12-17 (n={tem.sum()}): 8-class acc={acc8:.4f}, normal/abnormal acc={acc2:.4f}  (prototype baseline {base_acc:.4f})")
OUT["image"] = dict(n_test=int(tem.sum()), acc_8class=round(float(acc8), 4), acc_normal_vs_abnormal=round(float(acc2), 4), prototype_baseline=round(float(base_acc), 4))
final_img = make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=3000)).fit(Xi, yi)   # final model uses all images
joblib.dump({"model": final_img, "kind2pid": KIND2PID}, ART / "scan_clf.joblib")

# ---------------------------------------------------------------- cross-modal triplets (held-out images 12+)
kinds = list(img.classes_)
def img_pid_probs(path):
    pr = img.predict_proba([feat(Image.open(G / path))])[0]; d = collections.defaultdict(float)
    for k, p in zip(kinds, pr): d[KIND2PID[k]] += p
    return d
docvec = TfidfVectorizer(sublinear_tf=True).fit([p["document_text"] for p in protos] + [r["positive"] for r in ev])
Dm = docvec.transform([p["document_text"] for p in protos])
def doc_pid(text):
    return pids[int(np.argmax((Dm @ docvec.transform([text]).T).toarray().ravel()))]
mm = rd("aether_multimodal_triplets_eval.jsonl"); ok = {"text_to_image": [0, 0], "image_to_text": [0, 0]}
for r in mm:
    d = r["direction"]
    if d == "text_to_image":
        pt = dict(zip(cls, clf.predict_proba([r["anchor"]])[0]))
        sp = sum(pt.get(k, 0) * v for k, v in img_pid_probs(r["positive_image"]).items()); sn = sum(pt.get(k, 0) * v for k, v in img_pid_probs(r["negative_image"]).items())
    else:
        pp = img_pid_probs(r["anchor_image"]); sp = pp.get(doc_pid(r["positive"]), 0); sn = pp.get(doc_pid(r["negative"]), 0)
    ok[d][0] += sp > sn; ok[d][1] += 1
for d, (a, n) in ok.items(): print(f"CROSS-MODAL {d}: {a}/{n} = {a/n:.4f}  (baseline text_to_image 0.281, chance 0.5)")
OUT["cross_modal"] = {d: dict(acc=round(a / n, 4), n=n) for d, (a, n) in ok.items()}
json.dump(OUT, open(ROOT / "docs" / "retriever_results.json", "w"), indent=1)
