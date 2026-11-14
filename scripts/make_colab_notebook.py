"""Build the self-contained Colab deploy notebook:  python3 scripts/make_colab_notebook.py <project_dir> <out.ipynb>
Embeds the project (base64 tar.gz, no trained artifacts - they are retrained on Colab so pickles match Colab's scikit-learn)."""
import sys, io, json, tarfile, base64
from pathlib import Path
ROOT = Path(sys.argv[1]).resolve(); OUT = Path(sys.argv[2])
SKIP = ("/.git", "__pycache__", "data/generated", "aether_protocols_256d.json", ".joblib", ".onnx", ".gguf")
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tf:
    for p in sorted(ROOT.rglob("*")):
        rel = p.relative_to(ROOT).as_posix()
        if p.is_file() and not any(s in "/" + rel for s in SKIP): tf.add(p, arcname=rel)
payload = base64.b64encode(buf.getvalue()).decode()

C_PARAMS = '''# @title Cell 1: Settings + install (≈30 s)
import os, sys, subprocess, secrets, platform
API_KEY = ""                 # @param {type:"string"}  leave blank to auto-generate a strong key
ENABLE_LIGHTGBM_ONNX = True  # @param {type:"boolean"}  train LightGBM+ONNX Tier 2 + verify ONNXRuntime parity
ENABLE_NASA_OSDR = True      # @param {type:"boolean"}  fetch live NASA OSDR baselines + NOAA SWPC space weather
BASE = os.environ.get("AETHER_BASE", "/content")
os.makedirs(BASE, exist_ok=True)
if not API_KEY.strip():
    API_KEY = secrets.token_urlsafe(24)
    print("Generated API key (copy it now):", API_KEY)
os.environ["AETHER_API_KEY"] = API_KEY.strip()
pkgs = ["numpy", "scipy", "scikit-learn", "joblib", "pillow", "jsonschema"]
if ENABLE_LIGHTGBM_ONNX:
    pkgs += ["lightgbm>=4.5", "onnx", "onnxmltools>=1.13", "onnxruntime>=1.20", "shap>=0.46"]
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q"] + pkgs)
CF = "/usr/local/bin/cloudflared"
if not os.environ.get("AETHER_SKIP_TUNNEL") and not os.path.exists(CF):
    subprocess.check_call("wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O %s && chmod +x %s" % (CF, CF), shell=True)
print("python", platform.python_version(), "| base dir", BASE)
'''
C_UNPACK = '''# @title Cell 2: Unpack the AETHER project (embedded)
import base64, io, tarfile, os
PAYLOAD = "%s"
PROJ = os.path.join(BASE, "aether")
os.makedirs(PROJ, exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(base64.b64decode(PAYLOAD)), mode="r:gz") as tf:
    tf.extractall(PROJ)
print("unpacked to", PROJ, "->", sorted(os.listdir(PROJ)))
''' % payload
C_TRAIN = '''# @title Cell 3: Build data, train models, run the self-checks (≈3-4 min)
import subprocess, sys, os
def run(args, env_extra=None, tail=6):
    env = dict(os.environ, PYTHONPATH=PROJ, **(env_extra or {}))
    r = subprocess.run([sys.executable] + args, cwd=PROJ, env=env, capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip().splitlines()
    print("$", " ".join(args)); print("\\n".join("   " + l for l in out[-tail:]))
    if r.returncode != 0: raise RuntimeError("step failed: " + " ".join(args))
run(["data/build_datasets.py"], tail=2)
if ENABLE_NASA_OSDR:
    run(["scripts/ingest_nasa_osdr.py", "."], tail=4)
run(["scripts/train_retrievers.py", "."], tail=5)
run(["scripts/tune_eval.py", "."], tail=8)           # tuned Tier 2 + accuracy/speed report
run(["scripts/train_temporal_tier2.py", "."], tail=6)  # temporal early-warning model
run(["scripts/oracle_check.py", "."], tail=5)        # independent md-threshold test
run(["scripts/demo_selftest.py", "."], tail=3)       # must end with TOTAL 34/34
'''
C_ONNX = '''# @title Cell 4 (optional): LightGBM -> ONNX Tier 2 (set ENABLE_LIGHTGBM_ONNX in Cell 1; NOT validated in the build sandbox)
if ENABLE_LIGHTGBM_ONNX:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "lightgbm>=4.5", "onnx", "onnxmltools>=1.13", "onnxruntime>=1.20", "shap>=0.46"])
    run(["-c", "from engine.tier2_risk_engine import train_and_export_tier2 as t; import json; m=t(); print(json.dumps(m['metrics'])[:400], m['onnx_size_mb'], 'MB')"], tail=4)
    print("ONNX Tier 2 built; the pipeline will prefer it over the sklearn fallback on next server start.")
else:
    print("skipped (sklearn Tier 2 in use)")
'''
C_SERVE = '''# @title Cell 5: Start the API + public HTTPS link (keep this cell running)
import subprocess, threading, time, re, json, os, sys, urllib.request
env = dict(os.environ, AETHER_API_KEY=API_KEY.strip())
srv = subprocess.Popen([sys.executable, "scripts/demo_server.py", ".", "8000", "127.0.0.1"], cwd=PROJ, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for _ in range(60):
    try:
        urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=2); break
    except Exception: time.sleep(1)
else: raise RuntimeError("server did not start: " + (srv.stdout.read() or ""))
public = "http://127.0.0.1:8000"
tun = None
if not os.environ.get("AETHER_SKIP_TUNNEL"):
    tun = subprocess.Popen(["cloudflared", "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:8000"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    t0 = time.time(); public = None
    while time.time() - t0 < 60:
        line = tun.stdout.readline()
        m = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", line or "")
        if m: public = m.group(0); break
    if not public: raise RuntimeError("no trycloudflare URL captured")
    time.sleep(4)
K = API_KEY.strip()
# Live verify OpenAI-compatible Web Demo API format (base_url + model + api_key)
def _check_v1():
    req1 = urllib.request.Request(public + "/v1/models", headers={"Authorization": "Bearer " + K})
    with urllib.request.urlopen(req1, timeout=15) as r:
        m = json.loads(r.read().decode())
    req2 = urllib.request.Request(public + "/v1/chat/completions",
        data=json.dumps({"model": "aether-flight-surgeon-v1", "messages": [{"role": "user", "content": "CO2 is 4 mmHg, what should we do?"}]}).encode(),
        headers={"Authorization": "Bearer " + K, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req2, timeout=15) as r:
        c = json.loads(r.read().decode())
    print("LIVE /v1/models:", [x["id"] for x in m.get("data", [])])
    print("LIVE /v1/chat/completions:", c["choices"][0]["message"]["content"].splitlines()[0])
_check_v1()
print("=" * 78)
print("WEB DEMO API CONFIG (OpenAI-compatible):")
print("  BASE_URL :", public + "/v1")
print("  MODEL    : aether-flight-surgeon-v1   (also: aether-triage-v1, aether-embedding-v1)")
print("  API_KEY  :", K)
print("-" * 78)
print(json.dumps({"base_url": public + "/v1", "model": "aether-flight-surgeon-v1", "api_key": K}, indent=2))
print("-" * 78)
print("PUBLIC URL      :", public)
print("WEB PAGE        :", public + "/            (paste the key in the page)")
print("OPENAPI SCHEMA  :", public + "/openapi.json")
print("AI TOOL DEFS    :", public + "/tools")
print("MCP (key in URL):", public + "/k/" + K + "/mcp      <- paste into an AI client that accepts a connector/MCP URL")
print("=" * 78)
print(f"""
curl -s -X POST "{public}/v1/chat/completions" -H "Authorization: Bearer {K}" -H "Content-Type: application/json" -d '{{"model":"aether-flight-surgeon-v1","messages":[{{"role":"user","content":"CO2 is 4 mmHg, what should we do?"}}]}}'
curl -s -X POST "{public}/ask" -H "X-API-Key: {K}" -d '{{"question":"CO2 is 4 mmHg, what should we do?"}}'
curl -s -X POST "{public}/triage" -H "X-API-Key: {K}" -d '{{"goes_proton_flux_pfu":42.5,"symptom_notes":"nausea after flare"}}'
""")
print("SECURITY: anyone with the URL+key can call this API. The URL changes every run; stop this cell to shut it down. Research prototype - no real patient data.")
if os.environ.get("AETHER_SKIP_TUNNEL"):
    srv.terminate()
else:
    try:
        while True: time.sleep(30)
    except KeyboardInterrupt:
        srv.terminate(); tun.terminate()
'''
MD = """# Project AETHER — Deploy as an API (API key + public link + AI connector)

**Run:** *Runtime → Run all* (CPU is fine). ≈5 min the first time. Copy the printed **PUBLIC URL** and **API KEY**.

* `POST /ask`, `/triage`, `/early` with header `X-API-Key: <key>` · `GET /openapi.json` · `GET /tools` (Claude/OpenAI tool definitions)
* **MCP link for AI clients:** `<PUBLIC URL>/k/<KEY>/mcp` (tools: `aether_ask`, `aether_triage`, `aether_early_warning`)
* Models are retrained inside Colab (so they match Colab's scikit-learn); Cell 3 prints accuracy, the independent md-threshold test, and a self-test that should end with `TOTAL 34/34`.
* Optional GPU-phase work (EmbeddingGemma / QLoRA fine-tune) lives in your Notebook 1; export to Drive, then re-run with the files in `AETHER_Exports`.

⚠️ Research prototype, not a medical device. The link is public to anyone holding the key; stop the last cell to shut it down."""
def code(src): return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": src.splitlines(keepends=True)}
nb = {"cells": [{"cell_type": "markdown", "metadata": {}, "source": MD.splitlines(keepends=True)}, code(C_PARAMS), code(C_UNPACK), code(C_TRAIN), code(C_ONNX), code(C_SERVE)],
      "metadata": {"colab": {"name": "04_AETHER_Deploy_API.ipynb", "provenance": []}, "kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 5}
OUT.write_text(json.dumps(nb)); print("wrote", OUT, f"{OUT.stat().st_size/1e6:.2f} MB (payload {len(payload)/1e6:.2f} MB b64)")
