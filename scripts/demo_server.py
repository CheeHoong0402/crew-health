"""AETHER demo server — stdlib only (no fastapi needed). Run:  python3 scripts/demo_server.py [project_dir] [port]
  GET  /            web page (ask a question / run triage presets)
  GET  /health
  POST /ask         {"question": "..."}                       -> best-matching NASA-STD-3001 protocol + actions
  POST /triage      {"goes_proton_flux_pfu": 42.5, ...}       -> full Section-6 triage JSON (+ timings)
  POST /early       {"history": [{...day1...}, ...]}          -> advisory early-warning score
Research prototype, not a medical device.
"""
import sys, os, json, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve(); PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
sys.path.insert(0, str(ROOT)); os.chdir(ROOT)
from engine.pipeline import AetherPipeline
from engine.tier1_hbm_physics import TelemetryInput
from engine.text_utils import expand_zh
import dataclasses
PIPE = AetherPipeline(); FIELDS = {f.name for f in dataclasses.fields(TelemetryInput)}
DISCLAIMER = "Research prototype - not a medical device. Follow your flight surgeon / mission procedures."

def ask(question: str):
    q = expand_zh(question.strip())
    if not q: return {"error": "empty question"}
    pd = PIPE.rag.text_clf.proba_dict(q) if PIPE.rag.text_clf else {}
    if not pd:  # fallback: embedding retrieval
        v = PIPE.rag.embed_text(q); sims = PIPE.rag.doc_matrix @ v
        pd = {p["id"]: float(s) for p, s in zip(PIPE.rag.protocols, sims)}
    ranked = sorted(pd.items(), key=lambda kv: -kv[1]); top, conf = ranked[0]; p = PIPE.rag.proto_by_id[top]
    out = {"question": question, "matched_protocol": p["title"], "protocol_id": top, "severity": p["severity"], "confidence": round(conf, 3),
           "time_to_criticality_min": p.get("ttc_minutes"), "crew_actions": p["crew_actions"], "hardware_directives": p["hardware_directives"],
           "medical_kit": p.get("med_kit"), "alternatives": [{"protocol_id": k, "title": PIPE.rag.proto_by_id[k]["title"], "score": round(v, 3)} for k, v in ranked[1:3]],
           "disclaimer": DISCLAIMER}
    if conf < 0.35:
        out["note"] = "Low confidence - the question is vague. Give symptoms or readings (e.g. 'CO2 is 4 mmHg', '血糖 55') or use /triage with telemetry."
    return out

def triage(body: dict):
    kw = {k: v for k, v in body.items() if k in FIELDS}
    for k, v in list(kw.items()):
        if k not in ("symptom_notes", "habitat_location", "crew_id"): kw[k] = float(v)
    if "recent_suit_impacts_7d" in kw: kw["recent_suit_impacts_7d"] = int(kw["recent_suit_impacts_7d"])
    unknown = sorted(set(body) - FIELDS)
    out, d = PIPE.run(TelemetryInput(**kw))
    return {"triage": out, "diagnostics": {"tier3_interlock": d.tier3_interlock_alert, "tier2_model_label(advisory)": d.tier2_predicted_label,
            "tier2_probabilities": d.tier2_probabilities, "rag_top": d.rag_matches[:2], "tier3_ms": d.tier3_ms, "total_ms": d.total_ms},
            "ignored_fields": unknown, "disclaimer": DISCLAIMER}

def early(body: dict):
    hist = []
    for day in body.get("history", []):
        kw = {k: float(v) for k, v in day.items() if k in FIELDS and k not in ("symptom_notes", "habitat_location", "crew_id")}
        if "recent_suit_impacts_7d" in kw: kw["recent_suit_impacts_7d"] = int(kw["recent_suit_impacts_7d"])
        hist.append(TelemetryInput(**kw))
    if len(hist) < 2 or PIPE.early is None: return {"error": "need >=2 daily records (ideally 8) and artifacts/tier2_temporal.joblib"}
    ew = PIPE.early.predict(hist); return {"probability": ew.probability, "triggered": ew.triggered, "threshold": ew.threshold, "top_trends": ew.top_trends, "advisory_only": True, "disclaimer": DISCLAIMER}

PRESETS = {"nominal": {}, "solar storm": {"goes_proton_flux_pfu": 42.5, "dosimeter_rate_usv_hr": 180, "symptom_notes": "nausea after flare"},
           "high CO2": {"cabin_ppco2_mmhg": 4.0}, "rover impact": {"ltv_imu_peak_g": 4.2, "recent_suit_impacts_7d": 3, "symptom_notes": "shoulder pain after jolt"},
           "low glucose": {"blood_glucose_mg_dl": 52}, "low BP": {"systolic_bp_mmhg": 84, "diastolic_bp_mmhg": 54, "resting_hr_bpm": 118}}
PAGE = """<!doctype html><meta charset=utf-8><title>AETHER demo</title><style>body{font:15px system-ui;max-width:860px;margin:24px auto;padding:0 12px}
input,button{font:inherit;padding:6px 10px;margin:2px}input#q{width:70%}pre{background:#f4f4f4;padding:10px;overflow:auto;max-height:420px}.r{color:#b00}.a{color:#b60}.g{color:#070}</style>
<h2>AETHER – Autonomous Flight Surgeon AI (demo)</h2><p><small>Research prototype, not a medical device.</small></p>
<h3>1. Ask a question (English / 中文)</h3><input id=q placeholder="e.g. CO2 is 4 mmHg, what should we do?  /  血糖很低怎么办"><button onclick=ask()>Ask</button>
<h3>2. Triage preset</h3><div id=pre></div><h3>Answer</h3><pre id=out>—</pre>
<script>const P=%PRESETS%;pre.innerHTML=Object.keys(P).map(k=>`<button onclick="tri('${k}')">${k}</button>`).join('');
async function post(u,b){const r=await fetch(u,{method:'POST',body:JSON.stringify(b)});return r.json()}
async function ask(){out.textContent='…';out.textContent=JSON.stringify(await post('/ask',{question:q.value}),null,1)}
async function tri(k){out.textContent='…';out.textContent=JSON.stringify(await post('/triage',P[k]),null,1)}</script>"""

class H(BaseHTTPRequestHandler):
    def _send(self, code, obj, ctype="application/json"):
        data = (obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)).encode(); self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.send_header("Access-Control-Allow-Origin", "*"); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if self.path == "/health": return self._send(200, {"status": "ok", "tier2": type(PIPE.tier2).__name__, "rag_text_clf": PIPE.rag.text_clf is not None, "early_warning": PIPE.early is not None})
        if self.path in ("/", "/index.html"): return self._send(200, PAGE.replace("%PRESETS%", json.dumps(PRESETS)), "text/html")
        self._send(404, {"error": "not found"})
    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            fn = {"/ask": lambda: ask(body.get("question", "")), "/triage": lambda: triage(body), "/early": lambda: early(body)}.get(self.path)
            if not fn: return self._send(404, {"error": "not found"})
            self._send(200, fn())
        except Exception as e: self._send(400, {"error": f"{type(e).__name__}: {e}"})
    def log_message(self, *a): pass

if __name__ == "__main__":
    print(f"AETHER demo on http://127.0.0.1:{PORT}  (Ctrl+C to stop)"); ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
