"""AETHER API server — stdlib only (no fastapi needed).
Run:  AETHER_API_KEY=secret python3 scripts/demo_server.py [project_dir] [port] [host]
Auth (when AETHER_API_KEY is set; all POST + /mcp need it): header `X-API-Key: <key>` or `Authorization: Bearer <key>`,
or key in the path:  /k/<key>/ask  /k/<key>/mcp   (for clients that can only take a URL).
  GET  /            web page (enter key, ask questions, run presets)       GET /health   status (no auth)
  GET  /openapi.json  OpenAPI 3 schema (for AI agents / Postman)           GET /tools    Claude/OpenAI-style tool definitions
  POST /ask      {"question": "..."}                -> matched NASA-STD-3001 protocol + crew actions
  POST /triage   {"goes_proton_flux_pfu": 42.5,...} -> Section-6 triage JSON
  POST /early    {"history":[{...day1...},...]}     -> advisory early-warning score
  POST /mcp      JSON-RPC 2.0 (MCP streamable-HTTP, tools: aether_ask / aether_triage / aether_early_warning)
Research prototype, not a medical device. Never put real patient data through it.
"""
import sys, os, json, time, hmac, collections, threading, dataclasses
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve(); PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
HOST = sys.argv[3] if len(sys.argv) > 3 else "127.0.0.1"
sys.path.insert(0, str(ROOT)); os.chdir(ROOT)
from engine.pipeline import AetherPipeline
from engine.tier1_hbm_physics import TelemetryInput
from engine.text_utils import expand_zh, reading_hints

PIPE = AetherPipeline(); FIELDS = {f.name for f in dataclasses.fields(TelemetryInput)}
STR_FIELDS = ("symptom_notes", "habitat_location", "crew_id")
DISCLAIMER = "Research prototype - not a medical device. Follow your flight surgeon / mission procedures."
MAX_BODY = 64 * 1024; RATE = 60  # requests/minute per client
_hits = collections.defaultdict(list); _lock = threading.Lock()

def api_key() -> str: return os.environ.get("AETHER_API_KEY", "").strip()

def ask(question: str):
    q = expand_zh(str(question).strip()[:2000])
    if not q: return {"error": "empty question"}
    pd = PIPE.rag.text_clf.proba_dict(q) if PIPE.rag.text_clf else {}
    if not pd:
        v = PIPE.rag.embed_text(q); sims = PIPE.rag.doc_matrix @ v
        pd = {p["id"]: float(s) for p, s in zip(PIPE.rag.protocols, sims)}
    hints = reading_hints(q)
    if hints:  # numeric readings that cross the plan's limits take priority over wording
        pd[hints[0][0]] = max(pd.get(hints[0][0], 0.0), 0.9)
    ranked = sorted(pd.items(), key=lambda kv: -kv[1]); top, conf = ranked[0]; p = PIPE.rag.proto_by_id[top]
    out = {"question": question, "matched_protocol": p["title"], "protocol_id": top, "severity": p["severity"], "confidence": round(conf, 3),
           "time_to_criticality_min": p.get("ttc_minutes"), "crew_actions": p["crew_actions"], "hardware_directives": p["hardware_directives"],
           "medical_kit": p.get("med_kit"), "alternatives": [{"protocol_id": k, "title": PIPE.rag.proto_by_id[k]["title"], "score": round(v, 3)} for k, v in ranked[1:3]],
           "disclaimer": DISCLAIMER}
    if hints: out["reading_flags"] = [h[1] for h in hints]
    if conf < 0.35:
        out["note"] = "Low confidence - the question is vague. Give symptoms or readings (e.g. 'CO2 is 4 mmHg', '血糖 55') or use triage with telemetry."
    return out

def _clean(d: dict) -> dict:
    kw = {k: (str(v)[:500] if k in STR_FIELDS else float(v)) for k, v in d.items() if k in FIELDS}
    if "recent_suit_impacts_7d" in kw: kw["recent_suit_impacts_7d"] = int(kw["recent_suit_impacts_7d"])
    return kw

def triage(body: dict):
    out, d = PIPE.run(TelemetryInput(**_clean(body)))
    return {"triage": out, "diagnostics": {"tier3_interlock": d.tier3_interlock_alert, "tier2_model_label(advisory)": d.tier2_predicted_label,
            "tier2_probabilities": d.tier2_probabilities, "rag_top": d.rag_matches[:2], "tier3_ms": d.tier3_ms, "total_ms": d.total_ms},
            "ignored_fields": sorted(set(body) - FIELDS), "disclaimer": DISCLAIMER}

def early(body: dict):
    hist = [TelemetryInput(**_clean(day)) for day in body.get("history", [])[:60]]
    if len(hist) < 2 or PIPE.early is None: return {"error": "need >=2 daily records (ideally 8) and artifacts/tier2_temporal.joblib"}
    ew = PIPE.early.predict(hist)
    return {"probability": ew.probability, "triggered": ew.triggered, "threshold": ew.threshold, "top_trends": ew.top_trends, "advisory_only": True, "disclaimer": DISCLAIMER}

# ------------------------------------------------------------------ tool metadata (MCP / OpenAI / Claude tool-use share these)
TEL_PROPS = {k: {"type": "number"} for k in sorted(FIELDS) if k not in STR_FIELDS}
TEL_PROPS["recent_suit_impacts_7d"] = {"type": "integer"}
for k in STR_FIELDS: TEL_PROPS[k] = {"type": "string"}
TOOLS = [
    {"name": "aether_ask", "description": "Ask a basic spaceflight-health question (English or Chinese). Returns the matching NASA-STD-3001 protocol with crew actions, hardware directives and medical-kit hint. Research prototype, not medical advice.",
     "inputSchema": {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"]}},
    {"name": "aether_triage", "description": "Run the 4-tier triage pipeline on telemetry (all fields optional; defaults are nominal). The deterministic interlock sets the alert level; ML is advisory. Returns Section-6 JSON.",
     "inputSchema": {"type": "object", "properties": TEL_PROPS}},
    {"name": "aether_early_warning", "description": "Advisory early-warning score from daily telemetry history (oldest first, ideally >=8 days). Never changes an alert level.",
     "inputSchema": {"type": "object", "properties": {"history": {"type": "array", "items": {"type": "object", "properties": TEL_PROPS}}}, "required": ["history"]}},
]
HANDLERS = {"aether_ask": lambda a: ask(a.get("question", "")), "aether_triage": triage, "aether_early_warning": early}
ROUTES = {"/ask": HANDLERS["aether_ask"], "/triage": HANDLERS["aether_triage"], "/early": HANDLERS["aether_early_warning"]}

OPENAI_MODELS = [
    {"id": "aether-flight-surgeon-v1", "object": "model", "created": 1731628800, "owned_by": "project-aether"},
    {"id": "aether-triage-v1", "object": "model", "created": 1731628800, "owned_by": "project-aether"},
    {"id": "aether-embedding-v1", "object": "model", "created": 1731628800, "owned_by": "project-aether"},
]

def _extract_user_text(messages: list) -> str:
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "user":
            c = m.get("content", "")
            if isinstance(c, list):
                return " ".join(str(p.get("text", "")) for p in c if isinstance(p, dict) and p.get("type") == "text").strip()
            return str(c).strip()
    return ""

def _format_aether_reply(res: dict, is_triage: bool) -> str:
    if is_triage:
        t = res.get("triage", {})
        actions = "\n".join(f"- {a}" for a in t.get("immediate_crew_actions", []))
        dirs = ", ".join(t.get("hardware_bus_directives", []))
        med = t.get("offline_medical_kit_lookup", {}).get("recommended_agent", "N/A")
        return (
            f"**Alert Level:** {t.get('alert_level')} | **TTC:** {t.get('time_to_criticality_minutes')} min\n"
            f"**Syndromes:** {', '.join(t.get('detected_syndromes', []))}\n"
            f"**Crew Actions:**\n{actions}\n"
            f"**Hardware Directives:** `{dirs}`\n"
            f"**Medical Kit:** {med}\n\n"
            f"```json\n{json.dumps(t, ensure_ascii=False, indent=2)}\n```\n"
            f"_{DISCLAIMER}_"
        )
    if "error" in res:
        return f"Error: {res['error']}"
    actions = "\n".join(f"- {a}" for a in res.get("crew_actions", []))
    dirs = ", ".join(res.get("hardware_directives", []))
    med = (res.get("medical_kit") or {}).get("recommended_agent", "N/A")
    flags = f"\n**Reading Flags:** {', '.join(res['reading_flags'])}" if res.get("reading_flags") else ""
    note = f"\n\n> {res['note']}" if res.get("note") else ""
    return (
        f"**Protocol:** {res.get('matched_protocol')} (`{res.get('protocol_id')}`)\n"
        f"**Severity:** {res.get('severity')} | **Confidence:** {res.get('confidence')} | **TTC:** {res.get('time_to_criticality_min')} min{flags}\n"
        f"**Crew Actions:**\n{actions}\n"
        f"**Hardware Directives:** `{dirs}`\n"
        f"**Medical Kit:** {med}{note}\n\n"
        f"_{DISCLAIMER}_"
    )

def chat_completions(body: dict):
    model = str(body.get("model") or "aether-flight-surgeon-v1")
    user_text = _extract_user_text(body.get("messages") or [])
    if not user_text:
        return {"error": {"message": "messages must contain a non-empty user turn", "type": "invalid_request_error"}}
    is_triage = False
    raw_res = None
    if user_text.lstrip().startswith("{"):
        try:
            parsed = json.loads(user_text)
            if isinstance(parsed, dict) and (set(parsed) & FIELDS or model == "aether-triage-v1"):
                raw_res = triage(parsed); is_triage = True
        except Exception:
            raw_res = None
    if raw_res is None:
        raw_res = triage({}) if model == "aether-triage-v1" and not user_text else ask(user_text)
    reply_text = _format_aether_reply(raw_res, is_triage)
    cid = f"chatcmpl-aether-{int(time.time() * 1000)}"
    ptok, ctok = max(1, len(user_text) // 4), max(1, len(reply_text) // 4)
    return {
        "id": cid, "object": "chat.completion", "created": int(time.time()), "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": reply_text}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": ptok, "completion_tokens": ctok, "total_tokens": ptok + ctok},
        "aether": raw_res,
    }

def embeddings_v1(body: dict):
    inp = body.get("input", "")
    texts = [inp] if isinstance(inp, str) else [str(x) for x in (inp or [])]
    data = [{"object": "embedding", "index": i, "embedding": [round(float(x), 6) for x in PIPE.rag.embed_text(t)]} for i, t in enumerate(texts)]
    return {"object": "list", "data": data, "model": str(body.get("model") or "aether-embedding-v1"), "usage": {"prompt_tokens": sum(max(1, len(t) // 4) for t in texts), "total_tokens": sum(max(1, len(t) // 4) for t in texts)}}

ROUTES["/v1/chat/completions"] = chat_completions
ROUTES["/chat/completions"] = chat_completions
ROUTES["/v1/embeddings"] = embeddings_v1
ROUTES["/embeddings"] = embeddings_v1

def openapi(base: str):
    def op(summary, schema): return {"post": {"summary": summary, "security": [{"ApiKey": []}], "requestBody": {"required": True, "content": {"application/json": {"schema": schema}}},
                                             "responses": {"200": {"description": "JSON result"}, "401": {"description": "missing/invalid API key"}, "429": {"description": "rate limit"}}}}
    return {"openapi": "3.0.3", "info": {"title": "AETHER Flight Surgeon AI API", "version": "1.0", "description": DISCLAIMER}, "servers": [{"url": base}],
            "components": {"securitySchemes": {"ApiKey": {"type": "apiKey", "in": "header", "name": "X-API-Key"}, "BearerAuth": {"type": "http", "scheme": "bearer"}}},
            "paths": {"/ask": op("Ask a question", TOOLS[0]["inputSchema"]), "/triage": op("Triage telemetry", TOOLS[1]["inputSchema"]), "/early": op("Early warning", TOOLS[2]["inputSchema"]),
                      "/v1/chat/completions": op("OpenAI-compatible chat completions", {"type": "object", "properties": {"model": {"type": "string"}, "messages": {"type": "array"}, "stream": {"type": "boolean"}}, "required": ["messages"]}),
                      "/v1/models": {"get": {"summary": "List OpenAI-compatible models", "responses": {"200": {"description": "model list"}}}},
                      "/health": {"get": {"summary": "Status", "responses": {"200": {"description": "ok"}}}}}}

def mcp(msg):
    """Minimal MCP (JSON-RPC 2.0) over streamable-HTTP, JSON responses. Returns (status, body|None)."""
    mid, method, params = msg.get("id"), msg.get("method", ""), msg.get("params") or {}
    if mid is None: return 202, None  # notification
    def ok(r): return 200, {"jsonrpc": "2.0", "id": mid, "result": r}
    def err(c, m): return 200, {"jsonrpc": "2.0", "id": mid, "error": {"code": c, "message": m}}
    if method == "initialize":
        return ok({"protocolVersion": params.get("protocolVersion", "2025-03-26"), "capabilities": {"tools": {}}, "serverInfo": {"name": "aether-flight-surgeon", "version": "1.0"},
                   "instructions": DISCLAIMER})
    if method == "ping": return ok({})
    if method == "tools/list": return ok({"tools": TOOLS})
    if method == "tools/call":
        fn = HANDLERS.get(params.get("name"))
        if not fn: return err(-32602, "unknown tool")
        try: res = fn(params.get("arguments") or {}); return ok({"content": [{"type": "text", "text": json.dumps(res, ensure_ascii=False)}], "isError": "error" in res})
        except Exception as e: return ok({"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True})
    return err(-32601, f"method not found: {method}")

PRESETS = {"nominal": {}, "solar storm": {"goes_proton_flux_pfu": 42.5, "dosimeter_rate_usv_hr": 180, "symptom_notes": "nausea after flare"},
           "high CO2": {"cabin_ppco2_mmhg": 4.0}, "rover impact": {"ltv_imu_peak_g": 4.2, "recent_suit_impacts_7d": 3, "symptom_notes": "shoulder pain after jolt"},
           "low glucose": {"blood_glucose_mg_dl": 52}, "low BP": {"systolic_bp_mmhg": 84, "diastolic_bp_mmhg": 54, "resting_hr_bpm": 118}}
PAGE = """<!doctype html><meta charset=utf-8><title>AETHER</title><style>body{font:15px system-ui;max-width:880px;margin:24px auto;padding:0 12px}
input,button{font:inherit;padding:6px 10px;margin:2px}input#q{width:64%}pre{background:#f4f4f4;padding:10px;overflow:auto;max-height:420px}.cfg{background:#eef4ff;padding:10px;border-radius:6px;font-family:monospace;font-size:13px}</style>
<h2>AETHER – Autonomous Flight Surgeon AI</h2><p><small>Research prototype, not a medical device. Do not enter real patient data.</small></p>
<div class=cfg><b>Web Demo API Config:</b> Base URL = <code id=burl></code>/v1 &nbsp;|&nbsp; Model = <code>aether-flight-surgeon-v1</code> &nbsp;|&nbsp; Auth = <code>Authorization: Bearer &lt;API_KEY&gt;</code></div>
<p>API key: <input id=k type=password placeholder="X-API-Key / Bearer token"> <small>(kept in this page only)</small></p>
<h3>1. Ask / Chat (English / 中文)</h3><input id=q placeholder="CO2 is 4 mmHg, what should we do?  /  血糖很低怎么办"><button onclick=ask()>Ask (/ask)</button><button onclick=chat()>Chat (/v1/chat/completions)</button>
<h3>2. Triage preset</h3><div id=pre></div><h3>Answer</h3><pre id=out>—</pre>
<script>const P=%PRESETS%;burl.textContent=location.origin;pre.innerHTML=Object.keys(P).map(n=>`<button onclick="tri('${n}')">${n}</button>`).join('');
async function post(u,b){const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':k.value,'Authorization':'Bearer '+k.value},body:JSON.stringify(b)});return r.json()}
async function ask(){out.textContent='…';out.textContent=JSON.stringify(await post('/ask',{question:q.value}),null,1)}
async function chat(){out.textContent='…';out.textContent=JSON.stringify(await post('/v1/chat/completions',{model:'aether-flight-surgeon-v1',messages:[{role:'user',content:q.value}]}),null,1)}
async function tri(n){out.textContent='…';out.textContent=JSON.stringify(await post('/triage',P[n]),null,1)}</script>"""

class H(BaseHTTPRequestHandler):
    server_version = "AETHER/1.0"
    def _send(self, code, obj, ctype="application/json", extra=None):
        data = b"" if obj is None else (obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)).encode(); self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8"); self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization, Mcp-Session-Id")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(data)
    def _route(self):
        """strip optional /k/<key>/ prefix -> (path, key_from_path)"""
        p = self.path.split("?")[0]
        if p.startswith("/k/"):
            parts = p.split("/", 3)
            return "/" + (parts[3] if len(parts) > 3 else ""), parts[2]
        return p, ""
    def _authed(self, path_key) -> bool:
        want = api_key()
        if not want: return True
        got = self.headers.get("X-API-Key", "") or (self.headers.get("Authorization", "")[7:] if self.headers.get("Authorization", "").startswith("Bearer ") else "") or path_key
        return hmac.compare_digest(got.encode(), want.encode())
    def _limited(self) -> bool:
        ip = self.headers.get("CF-Connecting-IP") or self.client_address[0]; now = time.time()
        with _lock:
            h = [t for t in _hits[ip] if now - t < 60]; h.append(now); _hits[ip] = h
        return len(h) > RATE
    def do_OPTIONS(self): self._send(204, None)
    def do_GET(self):
        path, pk = self._route(); host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host", "")
        base = f"https://{host}" if self.headers.get("X-Forwarded-Proto", "") == "https" or "trycloudflare" in host else f"http://{host}"
        if path == "/health": return self._send(200, {"status": "ok", "auth_required": bool(api_key()), "tier2": type(PIPE.tier2).__name__, "rag_text_clf": PIPE.rag.text_clf is not None, "early_warning": PIPE.early is not None})
        if path in ("/v1/models", "/models"): return self._send(200, {"object": "list", "data": OPENAI_MODELS})
        if path in ("/", "/index.html"): return self._send(200, PAGE.replace("%PRESETS%", json.dumps(PRESETS)), "text/html")
        if path == "/openapi.json": return self._send(200, openapi(base))
        if path == "/tools": return self._send(200, {"claude_tools": [{"name": t["name"], "description": t["description"], "input_schema": t["inputSchema"]} for t in TOOLS],
                                                      "openai_tools": [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]}} for t in TOOLS]})
        self._send(404, {"error": "not found"})
    def _send_sse_chat(self, resp: dict):
        content = resp["choices"][0]["message"]["content"]
        c1 = {"id": resp["id"], "object": "chat.completion.chunk", "created": resp["created"], "model": resp["model"],
              "choices": [{"index": 0, "delta": {"role": "assistant", "content": content}, "finish_reason": None}]}
        c2 = {"id": resp["id"], "object": "chat.completion.chunk", "created": resp["created"], "model": resp["model"],
              "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        raw = f"data: {json.dumps(c1, ensure_ascii=False)}\n\ndata: {json.dumps(c2, ensure_ascii=False)}\n\ndata: [DONE]\n\n".encode()
        self.send_response(200); self.send_header("Content-Type", "text/event-stream; charset=utf-8"); self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(raw)
    def do_POST(self):
        path, pk = self._route()
        if not self._authed(pk): return self._send(401, {"error": "missing or invalid API key (X-API-Key header, Bearer token, or /k/<key>/ path)"}, extra={"WWW-Authenticate": "Bearer"})
        if self._limited(): return self._send(429, {"error": f"rate limit {RATE}/min"})
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > MAX_BODY: return self._send(413, {"error": "body too large"})
            body = json.loads(self.rfile.read(n) or b"{}")
            if path == "/mcp":
                code, resp = mcp(body) if isinstance(body, dict) else (200, {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "batch not supported"}})
                return self._send(code, resp)
            fn = ROUTES.get(path)
            if not fn: return self._send(404, {"error": "not found"})
            res = fn(body)
            if path in ("/v1/chat/completions", "/chat/completions") and body.get("stream") and "choices" in res:
                return self._send_sse_chat(res)
            self._send(200, res)
        except Exception as e: self._send(400, {"error": f"{type(e).__name__}: {e}"})
    def log_message(self, *a): pass

if __name__ == "__main__":
    print(f"AETHER API on http://{HOST}:{PORT}  auth={'ON' if api_key() else 'OFF (set AETHER_API_KEY)'}  (Ctrl+C to stop)", flush=True)
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
