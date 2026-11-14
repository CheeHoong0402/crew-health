# AETHER — Test Report & Build Guide (2026-11-14)

Scope: what was trained and measured in a CPU-only sandbox (2 vCPU, 7 GB RAM, no GPU, no PyTorch/LightGBM/ONNX tooling),
and how to get the AI parts to the best spec on a GPU. Spec reference: `docs/architecture_plan.md`.

## 1. What was and was not done

| Item | Status |
|---|---|
| Tier 2 fine-tune / hyper-parameter tuning | **Done** (scikit-learn HistGradientBoosting, not LightGBM) |
| Tier 3.5 embedding fine-tune (EmbeddingGemma) | **Not possible here** (no PyTorch/GPU). Baseline measured, plan in §4 |
| Tier 4 QLoRA (Phi-3.5-mini) | **Not possible here**. Baseline measured, plan in §5 |
| Push to GitHub | **Not done** — session has no GitHub access to `CheeHoong0402/crew-health`. A committed repo/bundle is provided |
| Real data in the model | Only live NOAA GOES values were fed to the interlock. No NASA OSDR data was ingested into training |

## 2. Results

### Tier 2 (anomaly model) — 15k train / 5k val / 5k test, plus 3k out-of-distribution (OOD) extreme scenarios

| Model | Test acc | Macro-F1 | RED recall | RED→GREEN | OOD RED recall |
|---|---|---|---|---|---|
| A plain | 99.66% | 0.996 | 99.86% | 0 | **30.8%** |
| B 10× RED weight (plan §5) | 99.60% | 0.996 | 99.93% | 0 | 46.7% |
| C tuned (lr 0.05, 15 leaves) | 99.64% | 0.996 | 99.93% | 0 | 46.5% |
| **D tuned + 5,000 extreme scenarios** (shipped) | 99.54% | 0.995 | 99.72% | 0 | **100%** |

Speed: Tier 2 single row p50 2.2 ms / p95 3.6 ms / p99 4.4 ms; batch ≈ 122k rows/s; model file 0.67 MB (plan limit 15 MB).
Weakest scenario: `metabolic_infectious_crisis` 98.3%.

### Tier 3 interlock
25/25 plan-threshold checks pass (16 boundary pairs, 5 compound syndromes, schema keys, 25,000 rows). Runtime ≈ 0.01 ms (limit 5 ms).

### Tier 3.5 RAG (hash-embedding baseline, 10 protocols)
Text retrieval (420 eval triplets): **recall@1 56.9%, recall@3 80.0%**, triplet accuracy 85.0%, p95 0.2 ms.
Text→image triplets: **28%** (chance 50%) — the hash text embedder and image-signature embedder share no space, so this number is not meaningful until a real multimodal model is used.
Image scan classification (nearest prototype, earlier run): 143/144.

### End-to-end (real Tier 1/3/3.5/4 + tuned Tier 2), 1,500 held-out scenarios
Alert accuracy **99.93%**, CRITICAL_RED missed **0**, JSON schema valid **100%**, latency p50 12.9 ms / p95 19.7 ms / p99 22.5 ms.

## 3. Findings you should know before trusting these numbers

1. **Accuracy is partly circular.** CSV labels equal the Tier-3 interlock output on 100% of checked rows, so Tier 2 is learning the rule set, not independent clinical truth. 99.5% means "reproduces the rules", not "diagnoses astronauts".
2. **Tier 2 is not temporal as built.** The plan calls for 24 h / 7 d / 30 d rolling windows (TFT/LightGBM). The model sees 33 snapshot features with only one 7-day delta. The early-warning value (catching syndromes *before* thresholds are crossed) is untested.
3. **Tree models do not extrapolate.** Plain models called 53–69% of extreme events (e.g. 900 pfu, CO₂ 9 mmHg) nominal. Augmenting with extremes fixed the OOD test, but that test uses the same generator family; unseen extreme *types* are still unproven. The interlock override is what actually guarantees safety — keep it as the final authority.
4. **Interlock deviates from the md in one row:** suit impact fires RED on >2.5 g alone; the plan says >2.5 g AND clavicle stress >80%. It also adds O₂ <19.5%, cabin <96 kPa, suit <3.9 psi RED triggers not in the md.
5. **RAG is the weakest tier** (57% recall@1) — this is where fine-tuning will pay off most.

## 4. How to build the AI parts to best spec (GPU phase)

**Tier 2 — model**
- Train LightGBM (as planned) with the same 10× RED weight; keep the extreme-scenario augmentation; add monotonic constraints (e.g. higher proton flux/CO₂ never lowers risk) — this directly fixes finding 3.
- Build real temporal features: rolling mean/slope/min/max over 24 h/7 d/30 d per vital, plus time-since-threshold. Evaluate with **group-split by crew/mission** so windows from one astronaut never straddle train/test.
- Get labels that are not the interlock: flight-surgeon-labelled vignettes (even 300–500) as a held-out gold set, and public spaceflight/analog data (NASA OSDR studies, bed-rest and ground-analog datasets) for baselines. Report calibration (ECE) and threshold-at-fixed-recall false-alarm rate, not just accuracy.
- Export to ONNX (<15 MB) — expect <1 ms vs 2.2 ms here.

**Tier 3.5 — embeddings (biggest gain)**
- Fine-tune EmbeddingGemma (text, 256-d MRL truncation) with contrastive loss (MultipleNegativesRanking) on the 1,820 training text triplets (420 held out); add hard negatives (the sibling protocols) and paraphrase augmentation; grow beyond 10 protocols so the benchmark is not trivial.
- Target: recall@1 ≥ 95%, recall@3 ≥ 99% on a held-out set of *human-written* queries.
- For images: use a real vision encoder and real, licensed clinical images (ultrasound, fundus, X-ray); the current PNGs are synthetic toys and cross-modal results on them prove nothing.

**Tier 4 — action SLM**
- QLoRA Phi-3.5-mini (r=16–32, 4-bit NF4, loss on the JSON output only) on the SFT set. 2,640 rows teaches format; for robust behaviour build 10–20k with varied phrasing and compound cases. Quantize Q4_K_M, run with the GBNF grammar.
- Hard rules around it: after generation, **overwrite `alert_level`, TTC and syndromes with the interlock values** and validate hardware directives and medication names against closed vocabularies. Evaluate exact-match on those fields (must be 100%), field-F1 on actions/directives, and hallucinated-drug rate (must be 0).
- Honest trade-off: the deterministic Tier 4 already gives 100% schema-valid output in ~1 ms. The SLM only adds natural-language fluency; on a laptop CPU it will likely add seconds, so run it asynchronously after the Tier 1–3 alert is already out.

**Latency budget to hold:** Tier 3 <5 ms (now 0.01), Tier 1–3.5 + Tier 2 <50 ms (now ~13 ms), SLM explanation asynchronous.

**Release gates:** RED recall ≥99.9% on the gold set *with* interlock override; zero schema failures; interlock 100% on the plan-conformance suite; thresholds signed off by a flight surgeon. This is a research prototype, not a medical device.

## 5. Suggested run order on Colab (free T4)
1. Regenerate data, add real-data/gold sets. 2. Embedding fine-tune → measure recall@k with `scripts/tune_eval.py`. 3. LightGBM+ONNX Tier 2 with temporal features. 4. QLoRA Tier 4 → GGUF → grammar-constrained eval. 5. Re-run `scripts/plan_conformance.py` and `scripts/tune_eval.py`; compare against this report.

Reproduce: see `README.md`. Raw numbers: `docs/eval_results.json`.
