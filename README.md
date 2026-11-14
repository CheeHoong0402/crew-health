# Project AETHER — Autonomous Flight Surgeon AI (crew-health)

4-tier offline health-monitoring pipeline (Tier 1 HBM physics, Tier 2 anomaly ML, Tier 3 NASA-STD-3001 interlock,
Tier 3.5 multimodal RAG, Tier 4 Section-6 JSON). Spec: `docs/architecture_plan.md`. Results: `docs/REPORT.md`.

    python3 data/build_datasets.py          # (from repo root, with PYTHONPATH=.) generate 25k scenarios + SFT/triplet data
    python3 scripts/tune_eval.py .          # tune Tier 2, evaluate accuracy/speed, writes artifacts/tier2_hgb_tuned.joblib
    python3 scripts/plan_conformance.py .   # threshold-by-threshold check against the plan
    python3 scripts/demo_smoke_test.py .    # scenario demo
    python3 scripts/train_retrievers.py .   # trained text/scan retrievers (artifacts/rag_text_clf, scan_clf)
    python3 scripts/train_temporal_tier2.py .  # temporal early-warning model (artifacts/tier2_temporal)
    python3 scripts/oracle_check.py .       # independent test vs md thresholds

Tier 2 uses LightGBM->ONNX when available, else `engine/tier2_sklearn_fallback.py`.
Safety: research prototype, not a medical device. Thresholds must be validated by flight-surgeon review.

Policy: only the deterministic Tier 3 interlock (and abnormal scans) set the alert level; ML models are advisory
(`ML_CAN_ESCALATE_TO_RED/AMBER = False` in `engine/tier4_action_slm.py`). Optional `history=` on `AetherPipeline.run()` returns an early-warning score.
