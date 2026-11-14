"""
Mode B — FastAPI Real-Time & Offline-Edge API Server for Project AETHER.

Endpoints:
  GET  /health         System status, loaded backends, ONNX/GGUF availability
  GET  /protocols      List NASA-STD-3001 / HRP / OpenFDA protocol corpus
  POST /triage         Full 4-Tier triage (supports JSON vitals + optional base64 scan image)
                       Returns STRICT Section 6 JSON body + X-AETHER-* diagnostic headers
  POST /triage-full    Same triage plus full diagnostics & Tier 1 HBM state for rich HUD views
  POST /analyze-scan   Multipart file upload (+ optional telemetry JSON) -> Text+Vision 256d scan triage
  POST /embed          Generate 256d MRL embeddings for text query or uploaded image

Expose publicly in Mode B via Cloudflare Quick Tunnel (no account required):
  cloudflared tunnel --url http://localhost:8000
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from engine.pipeline import AetherPipeline
from engine.tier1_hbm_physics import TelemetryInput

app = FastAPI(
    title="Project AETHER — Autonomous Flight Surgeon AI API",
    version="1.0.0",
    description="Mode B Real-Time 4-Tier Neuro-Symbolic Space Medicine Engine (Text + Vision EmbeddingGemma 2 + ONNX + NASA-STD-3001)",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-AETHER-Total-Ms",
        "X-AETHER-Tier3-Ms",
        "X-AETHER-Tier2-Ms",
        "X-AETHER-RAG-Backend",
        "X-AETHER-Tier4-Backend",
    ],
)


@app.middleware("http")
async def optional_api_key_guard(request: Request, call_next):
    expected_key = os.environ.get("AETHER_API_KEY", "").strip()
    if (
        expected_key
        and request.method != "OPTIONS"
        and request.url.path not in {"/health", "/docs", "/redoc", "/openapi.json"}
    ):
        provided = request.headers.get("X-API-Key", "")
        if not provided and request.headers.get("Authorization", "").startswith("Bearer "):
            provided = request.headers["Authorization"].split(" ", 1)[1].strip()
        if provided != expected_key:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing X-API-Key"},
                headers={"Access-Control-Allow-Origin": "*"},
            )
    return await call_next(request)

_pipeline: Optional[AetherPipeline] = None


def get_pipeline() -> AetherPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = AetherPipeline()
    return _pipeline


class TelemetryRequest(BaseModel):
    resting_hr_bpm: float = 68.0
    hr_baseline_7d_delta_pct: float = 0.0
    systolic_bp_mmhg: float = 118.0
    diastolic_bp_mmhg: float = 76.0
    hrv_rmssd_ms: float = 42.0
    blood_glucose_mg_dl: float = 94.0
    core_temp_c: float = 36.8
    fluid_intake_l_24h: float = 2.6
    mass_change_48h_kg: float = -0.2
    sleep_hours_3d_avg: float = 7.6
    sleep_efficiency_pct: float = 88.0
    mood_score_1_10: float = 8.0
    reaction_time_ms: float = 245.0
    mission_elapsed_days: float = 30.0
    baseline_bone_mass_kg: float = 3.10
    ared_compliance_14d: float = 0.90
    baseline_shoulder_clearance_mm: float = 18.0
    suit_pressure_psi: float = 4.3
    ltv_imu_peak_g: float = 0.4
    recent_suit_impacts_7d: int = 0
    goes_proton_flux_pfu: float = 0.8
    goes_xray_flux_wm2: float = 1e-7
    dosimeter_rate_usv_hr: float = 25.0
    radin2_daily_usv: float = 480.0
    cumulative_career_msv: float = 95.0
    cabin_ppco2_mmhg: float = 1.6
    cabin_o2_pct: float = 21.0
    cabin_pressure_kpa: float = 101.3
    airborne_dust_mg_m3: float = 0.02
    symptom_notes: str = ""
    habitat_location: str = "Spacecraft"
    crew_id: str = "CDR-01"
    comms_mode: str = Field(
        default="LIVE_CLOUDFLARE_TUNNEL_API",
        description="OFFLINE_AUTONOMOUS_EDGE | LIVE_CLOUDFLARE_TUNNEL_API | HYBRID_WEBGPU_EDGE",
    )
    scan_image_base64: Optional[str] = Field(
        default=None,
        description="Optional base64 or data-URI encoded medical scan image (fundus, skin, ultrasound, clavicle).",
    )

    def to_telemetry_input(self) -> TelemetryInput:
        data = self.model_dump(exclude={"comms_mode", "scan_image_base64"})
        return TelemetryInput(**data)


class EmbedRequest(BaseModel):
    query: str
    is_query: bool = True


def _decode_base64_image(b64_str: Optional[str]) -> Optional[Image.Image]:
    if not b64_str:
        return None
    raw_b64 = b64_str.split(",", 1)[-1].strip()
    try:
        raw_bytes = base64.b64decode(raw_b64)
        return Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 scan image: {exc}") from exc


@app.get("/health")
def health() -> Dict[str, Any]:
    pipe = get_pipeline()
    return {
        "status": "nominal",
        "project": "AETHER / Aegis Crew HUD",
        "tier1_physics": "active",
        "tier2_onnx": str(pipe.tier2.onnx_path.name),
        "tier3_interlock": "NASA-STD-3001 (<5ms)",
        "tier3_5_rag_backend": pipe.rag.backend_name,
        "tier3_5_mrl_dim": 256,
        "tier4_slm_backend": pipe.tier4.backend,
        "protocol_count": len(pipe.rag.protocols),
        "scan_prototype_count": len(pipe.rag.scan_prototypes),
    }


@app.get("/protocols")
def list_protocols() -> Dict[str, Any]:
    pipe = get_pipeline()
    cleaned = []
    for p in pipe.rag.protocols:
        item = {k: v for k, v in p.items() if k != "embedding_256d"}
        cleaned.append(item)
    return {"protocols": cleaned}


@app.post("/triage")
def triage(req: TelemetryRequest, response: Response) -> Dict[str, Any]:
    pipe = get_pipeline()
    scan_im = _decode_base64_image(req.scan_image_base64)
    comms = req.comms_mode if req.comms_mode in {
        "OFFLINE_AUTONOMOUS_EDGE",
        "LIVE_CLOUDFLARE_TUNNEL_API",
        "HYBRID_WEBGPU_EDGE",
    } else "LIVE_CLOUDFLARE_TUNNEL_API"

    triage_json, diag = pipe.run(
        req.to_telemetry_input(),
        scan_image=scan_im,
        comms_mode=comms,
    )
    response.headers["X-AETHER-Total-Ms"] = str(diag.total_ms)
    response.headers["X-AETHER-Tier3-Ms"] = str(diag.tier3_ms)
    response.headers["X-AETHER-Tier2-Ms"] = str(diag.tier2_ms)
    response.headers["X-AETHER-RAG-Backend"] = diag.rag_backend
    response.headers["X-AETHER-Tier4-Backend"] = diag.tier4_backend
    return triage_json


@app.post("/triage-full")
def triage_full(req: TelemetryRequest) -> Dict[str, Any]:
    pipe = get_pipeline()
    scan_im = _decode_base64_image(req.scan_image_base64)
    triage_json, diag = pipe.run(
        req.to_telemetry_input(),
        scan_image=scan_im,
        comms_mode=req.comms_mode,
    )
    return {
        "triage": triage_json,
        "diagnostics": diag.__dict__,
    }


@app.post("/analyze-scan")
async def analyze_scan(
    file: UploadFile = File(...),
    telemetry_json: Optional[str] = Form(default=None),
) -> Dict[str, Any]:
    pipe = get_pipeline()
    raw = await file.read()
    try:
        im = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode uploaded image: {exc}") from exc

    t_req = TelemetryRequest()
    if telemetry_json:
        try:
            t_req = TelemetryRequest(**json.loads(telemetry_json))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid telemetry_json: {exc}") from exc

    triage_json, diag = pipe.run(
        t_req.to_telemetry_input(),
        scan_image=im,
        comms_mode="LIVE_CLOUDFLARE_TUNNEL_API",
    )
    return {
        "triage": triage_json,
        "scan_match": diag.scan_match,
        "rag_matches": diag.rag_matches,
        "hbm_state": diag.hbm_state,
        "total_ms": diag.total_ms,
    }


@app.post("/embed")
def embed_text(req: EmbedRequest) -> Dict[str, Any]:
    pipe = get_pipeline()
    vec = pipe.rag.embed_text(req.query, is_query=req.is_query)
    return {
        "dim": len(vec),
        "backend": pipe.rag.backend_name,
        "embedding_256d": [round(float(x), 6) for x in vec],
    }


@app.get("/v1/models")
def v1_models() -> Dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {"id": "aether-flight-surgeon-v1", "object": "model", "owned_by": "project-aether"},
            {"id": "aether-triage-v1", "object": "model", "owned_by": "project-aether"},
            {"id": "aether-embedding-v1", "object": "model", "owned_by": "project-aether"},
        ],
    }


@app.post("/v1/chat/completions")
def v1_chat_completions(body: Dict[str, Any]) -> Dict[str, Any]:
    from scripts.demo_server import chat_completions
    return chat_completions(body)
