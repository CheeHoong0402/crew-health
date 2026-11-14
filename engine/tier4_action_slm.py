"""
Tier 4 — Fine-Tuned Edge Action SLM + Strict Grammar-Constrained Section 6 Synthesis.

When `artifacts/aether_flight_surgeon_q4_k_m.gguf` and `llama-cpp-python` are installed,
decodes using `data/schema/aether_triage.gbnf` so syntax hallucinations are impossible,
while still preventing any ML downgrade of Tier 3 NASA-STD-3001 RED/AMBER alerts.
When running lightweight/in-browser or before downloading the 2.2 GB `.gguf`, uses
fast schema-validated deterministic synthesis grounded in Tier 1–3.5 outputs.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import jsonschema

from engine.tier1_hbm_physics import HBMState, TelemetryInput
from engine.tier2_risk_engine import Tier2Prediction
from engine.tier3_safety_interlock import SafetyInterlockResult
from engine.tier3_5_multimodal_rag import RetrievalMatch

ROOT_DIR = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT_DIR / "data" / "schema" / "triage_output.schema.json"
GBNF_PATH = ROOT_DIR / "data" / "schema" / "aether_triage.gbnf"
DEFAULT_GGUF_PATH = ROOT_DIR / "artifacts" / "aether_flight_surgeon_q4_k_m.gguf"

SEVERITY_RANK = {"NOMINAL_GREEN": 0, "CAUTION_AMBER": 1, "CRITICAL_RED": 2}


def _load_schema() -> Dict:
    with SCHEMA_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


class Tier4ActionSLM:
    def __init__(
        self,
        gguf_path: Path = DEFAULT_GGUF_PATH,
        gbnf_path: Path = GBNF_PATH,
    ) -> None:
        self.schema = _load_schema()
        self.gguf_path = gguf_path
        self.gbnf_path = gbnf_path
        self.llm = None
        self.grammar = None
        self.backend = "deterministic_synthesis"
        self._try_load_gguf()

    def _try_load_gguf(self) -> None:
        if not self.gguf_path.exists():
            return
        try:
            from llama_cpp import Llama, LlamaGrammar

            self.llm = Llama(
                model_path=str(self.gguf_path),
                n_ctx=2048,
                n_threads=4,
                verbose=False,
            )
            if self.gbnf_path.exists():
                self.grammar = LlamaGrammar.from_file(str(self.gbnf_path))
            self.backend = f"llama_cpp_gbnf ({self.gguf_path.name})"
        except Exception:
            self.llm = None
            self.grammar = None

    def _synthesize_deterministic(
        self,
        t: TelemetryInput,
        hbm: HBMState,
        tier2: Tier2Prediction,
        interlock: SafetyInterlockResult,
        retrieved: Sequence[RetrievalMatch],
        scan_match: Optional[Dict[str, object]],
        comms_mode: str,
    ) -> Dict:
        # Escalate alert to max of Tier 3 (un-overridable) and Tier 2 / abnormal scan finding
        final_alert = interlock.alert_level
        scan_proto_id: Optional[str] = None
        if scan_match and str(scan_match.get("protocol_id", "PROTO-NOM-01")) != "PROTO-NOM-01":
            scan_proto_id = str(scan_match["protocol_id"])
            matched_proto = next((m.protocol for m in retrieved if m.protocol_id == scan_proto_id), None)
            if matched_proto:
                sev = matched_proto.get("severity", "CAUTION_AMBER")
                if SEVERITY_RANK.get(sev, 0) > SEVERITY_RANK.get(final_alert, 0):
                    final_alert = sev

        if SEVERITY_RANK.get(tier2.predicted_label, 0) > SEVERITY_RANK.get(final_alert, 0):
            # ML can escalate early prodromal risk, never downgrade Tier 3
            if tier2.probabilities.get("CRITICAL_RED", 0.0) >= 0.72:
                final_alert = "CRITICAL_RED"
            elif SEVERITY_RANK[final_alert] == 0 and tier2.probabilities.get("CAUTION_AMBER", 0.0) >= 0.65:
                final_alert = "CAUTION_AMBER"

        active_protocols: List[Dict] = []
        seen_pids = set()
        proto_lookup = {m.protocol_id: m.protocol for m in retrieved}
        # Also include full protocol index from retrieved/Tier3 context if needed
        for pid in interlock.triggered_protocol_ids:
            if pid == "PROTO-NOM-01" and final_alert != "NOMINAL_GREEN":
                continue
            if pid in proto_lookup and pid not in seen_pids:
                seen_pids.add(pid)
                active_protocols.append(proto_lookup[pid])
        if scan_proto_id and scan_proto_id in proto_lookup and scan_proto_id not in seen_pids:
            seen_pids.add(scan_proto_id)
            active_protocols.append(proto_lookup[scan_proto_id])
        if not active_protocols and retrieved:
            for m in retrieved:
                if final_alert != "NOMINAL_GREEN" and m.protocol_id == "PROTO-NOM-01":
                    continue
                active_protocols.append(m.protocol)
                break
            if not active_protocols:
                active_protocols.append(retrieved[0].protocol)

        # Sort active protocols by clinical severity descending so primary & med_kit match highest risk
        active_protocols.sort(
            key=lambda p: SEVERITY_RANK.get(str(p.get("severity", "NOMINAL_GREEN")), 0),
            reverse=True,
        )

        syndromes = [
            s for s in interlock.detected_syndromes
            if not (final_alert != "NOMINAL_GREEN" and s == "NOMINAL_MICROGRAVITY_ADAPTATION")
        ]
        for p in active_protocols:
            sc = p["syndrome_code"]
            if sc != "NOMINAL_MICROGRAVITY_ADAPTATION" and sc not in syndromes:
                syndromes.append(sc)
        if not syndromes:
            syndromes = ["NOMINAL_MICROGRAVITY_ADAPTATION"]

        # Blend deterministic threshold attributions & Tier 2 SHAP causes
        shap_causes: List[Dict] = []
        seen_features = set()
        for feat, val, wt in interlock.deterministic_reasons:
            if feat in seen_features:
                continue
            seen_features.add(feat)
            shap_causes.append({
                "feature": feat,
                "value": round(float(val), 2),
                "impact_weight": round(max(0.0, min(1.0, float(wt))), 3),
            })
            if len(shap_causes) >= 3:
                break
        for item in tier2.top_shap_causes:
            if len(shap_causes) >= 3:
                break
            feat = str(item["feature"])
            if feat in seen_features:
                continue
            seen_features.add(feat)
            shap_causes.append({
                "feature": feat,
                "value": round(float(item["value"]), 2),
                "impact_weight": round(max(0.0, min(1.0, float(item["impact_weight"]))), 3),
            })
        if not shap_causes:
            shap_causes = list(tier2.top_shap_causes[:3])

        zones: List[Dict] = []
        seen_zones = set()
        actions: List[str] = []
        directives: List[str] = []
        for p in active_protocols:
            for z in p.get("hbm_zones", []):
                reg = z["anatomical_region"]
                if reg not in seen_zones:
                    seen_zones.add(reg)
                    zones.append(z)
            for a in p.get("crew_actions", []):
                if a not in actions:
                    actions.append(a)
            for d in p.get("hardware_directives", []):
                if d not in directives:
                    directives.append(d)

        if scan_match and scan_proto_id:
            actions.insert(
                0,
                f"Review attached medical scan finding ({scan_match['clinical_finding']}, score {scan_match['similarity']}).",
            )

        primary = active_protocols[0]
        ttc = interlock.time_to_criticality_minutes
        if ttc is None and final_alert != "NOMINAL_GREEN":
            ttc = primary.get("ttc_minutes") or (15 if final_alert == "CRITICAL_RED" else 720)

        payload = {
            "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "comms_mode": comms_mode,
            "alert_level": final_alert,
            "time_to_criticality_minutes": ttc,
            "detected_syndromes": syndromes,
            "shap_root_causes": shap_causes[:3],
            "hbm_3d_highlight_zones": zones[:4],
            "immediate_crew_actions": actions[:4],
            "hardware_bus_directives": directives[:4],
            "offline_medical_kit_lookup": primary["med_kit"],
        }
        return payload

    def synthesize(
        self,
        t: TelemetryInput,
        hbm: HBMState,
        tier2: Tier2Prediction,
        interlock: SafetyInterlockResult,
        retrieved: Sequence[RetrievalMatch],
        scan_match: Optional[Dict[str, object]] = None,
        comms_mode: str = "OFFLINE_AUTONOMOUS_EDGE",
    ) -> Dict:
        fallback = self._synthesize_deterministic(
            t, hbm, tier2, interlock, retrieved, scan_match, comms_mode
        )
        if self.llm is not None:
            try:
                proto_titles = [m.title for m in retrieved]
                prompt = (
                    "You are Project AETHER Autonomous Flight Surgeon AI. Output ONLY strict Section 6 JSON.\n"
                    f"TELEMETRY: HR={t.resting_hr_bpm:.1f}bpm, BP={t.systolic_bp_mmhg:.0f}/{t.diastolic_bp_mmhg:.0f}mmHg, "
                    f"Glucose={t.blood_glucose_mg_dl:.0f}mg/dL, Temp={t.core_temp_c:.1f}C, Sleep={t.sleep_hours_3d_avg:.1f}h, "
                    f"ppCO2={t.cabin_ppco2_mmhg:.2f}mmHg, Dust={t.airborne_dust_mg_m3:.2f}mg/m3, "
                    f"GOES_Proton={t.goes_proton_flux_pfu:.1f}pfu, LTV_g={t.ltv_imu_peak_g:.2f}g\n"
                    f"HBM_STATE: BoneRetention={hbm.bone_mass_retention_pct}%, ShoulderClearance={hbm.effective_hut_shoulder_clearance_mm}mm, "
                    f"CareerRad={hbm.career_dose_limit_pct}%, Hydration={hbm.hydration_index}\n"
                    f"INTERLOCK_ALERT={interlock.alert_level}, TTC_MIN={interlock.time_to_criticality_minutes}\n"
                    f"RETRIEVED_PROTOCOLS={proto_titles}\n"
                    "JSON:"
                )
                kwargs = {"max_tokens": 520, "temperature": 0.05}
                if self.grammar is not None:
                    kwargs["grammar"] = self.grammar
                out = self.llm(prompt, **kwargs)
                raw_text = out["choices"][0]["text"].strip()
                parsed = json.loads(raw_text)
                # Enforce Tier 3 safety guardrail dominance over any ML/SLM output
                if SEVERITY_RANK.get(parsed.get("alert_level", "NOMINAL_GREEN"), 0) < SEVERITY_RANK[fallback["alert_level"]]:
                    parsed["alert_level"] = fallback["alert_level"]
                    parsed["time_to_criticality_minutes"] = fallback["time_to_criticality_minutes"]
                parsed["comms_mode"] = comms_mode
                jsonschema.validate(instance=parsed, schema=self.schema)
                return parsed
            except Exception:
                pass

        jsonschema.validate(instance=fallback, schema=self.schema)
        return fallback
