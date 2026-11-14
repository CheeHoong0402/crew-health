"""
Unified 4-Tier Project AETHER Orchestrator Pipeline.

Executes:
  Tier 1: Physics-Informed HBM Digital Twin (M_bone(t), suit clearance, organ radiation)
  Tier 2: Temporal Anomaly LightGBM ONNX + SHAP TreeExplainer
  Tier 3: Deterministic NASA-STD-3001 Safety Interlock (< 5 ms, cannot be overridden)
  Tier 3.5: Offline Multimodal RAG (EmbeddingGemma 2 Text + Vision 256d MRL)
  Tier 4: Fine-Tuned Action SLM / GBNF Synthesis -> Strict Section 6 JSON
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from PIL import Image

from engine.tier1_hbm_physics import HBMState, TelemetryInput, compute_hbm_state
from engine.tier2_risk_engine import Tier2Prediction, Tier2RiskEngine
from engine.tier3_safety_interlock import SafetyInterlockResult, evaluate_safety_interlock
from engine.tier3_5_multimodal_rag import RetrievalMatch, Tier35MultimodalRAG
from engine.tier4_action_slm import Tier4ActionSLM


@dataclass
class PipelineDiagnostics:
    hbm_state: Dict
    tier2_probabilities: Dict[str, float]
    tier2_predicted_label: str
    tier2_ms: float
    tier3_interlock_alert: str
    tier3_ms: float
    rag_backend: str
    rag_matches: list
    scan_match: Optional[Dict]
    tier4_backend: str
    total_ms: float


class AetherPipeline:
    def __init__(self) -> None:
        try:
            self.tier2 = Tier2RiskEngine()  # LightGBM -> ONNX (plan Section 5)
        except (FileNotFoundError, ImportError):
            from engine.tier2_sklearn_fallback import Tier2SklearnEngine
            self.tier2 = Tier2SklearnEngine()  # tuned sklearn fallback, no extra deps
        self.rag = Tier35MultimodalRAG()
        self.tier4 = Tier4ActionSLM()

    def run(
        self,
        telemetry: TelemetryInput,
        scan_image: Optional[Image.Image] = None,
        comms_mode: str = "OFFLINE_AUTONOMOUS_EDGE",
    ) -> Tuple[Dict, PipelineDiagnostics]:
        t0 = time.perf_counter()

        # Tier 1: Deterministic Physics Digital Twin
        hbm: HBMState = compute_hbm_state(telemetry)

        # Tier 3: Un-overridable NASA-STD-3001 Safety Interlock (< 5 ms)
        interlock: SafetyInterlockResult = evaluate_safety_interlock(telemetry, hbm)

        # Tier 2: LightGBM ONNX Multi-System Anomaly + SHAP
        tier2_pred: Tier2Prediction = self.tier2.predict(telemetry, hbm)

        # Tier 3.5: Multimodal Retrieval (Text + Scan Photo) over 256d MRL Index
        query_text = self.rag.build_telemetry_query(telemetry, hbm, interlock)
        matches, scan_match = self.rag.retrieve(
            query_text=query_text,
            scan_image=scan_image,
            interlock_protocol_ids=interlock.triggered_protocol_ids,
            top_k=3,
        )

        # Tier 4: Grammar-constrained Section 6 JSON synthesis
        triage_json = self.tier4.synthesize(
            t=telemetry,
            hbm=hbm,
            tier2=tier2_pred,
            interlock=interlock,
            retrieved=matches,
            scan_match=scan_match,
            comms_mode=comms_mode,
        )

        total_ms = round((time.perf_counter() - t0) * 1000.0, 3)
        diag = PipelineDiagnostics(
            hbm_state=hbm.to_dict(),
            tier2_probabilities=tier2_pred.probabilities,
            tier2_predicted_label=tier2_pred.predicted_label,
            tier2_ms=tier2_pred.inference_ms,
            tier3_interlock_alert=interlock.alert_level,
            tier3_ms=interlock.execution_ms,
            rag_backend=self.rag.backend_name,
            rag_matches=[
                {
                    "id": m.protocol_id,
                    "title": m.title,
                    "severity": m.severity,
                    "similarity": m.similarity,
                }
                for m in matches
            ],
            scan_match=scan_match,
            tier4_backend=self.tier4.backend,
            total_ms=total_ms,
        )
        return triage_json, diag
