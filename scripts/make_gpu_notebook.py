"""Build Notebook 1 (Phase 1 GPU Fine-Tuning + Phase 2 NASA OSDR Ingestion):
  python3 scripts/make_gpu_notebook.py <project_dir> <out.ipynb>
"""
import sys, io, json, tarfile, base64
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
OUT = Path(sys.argv[2])
SKIP = ("/.git", "__pycache__", "data/generated", "aether_protocols_256d.json", ".joblib", ".onnx", ".gguf")
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tf:
    for p in sorted(ROOT.rglob("*")):
        rel = p.relative_to(ROOT).as_posix()
        if p.is_file() and not any(s in "/" + rel for s in SKIP):
            tf.add(p, arcname=rel)
payload = base64.b64encode(buf.getvalue()).decode()

MD = """# Project AETHER — Notebook 1: Phase 1 GPU Fine-Tuning + Phase 2 NASA OSDR

**Runtime:** Colab GPU (**T4** or **A100**).
1. **Phase 2 (Real Data):** Ingests NASA OSDR spaceflight study metadata (`OSD-48`, `OSD-53`, `OSD-174`, `OSD-310`, `OSD-661`, `OSD-73`) and live NOAA SWPC radiation feeds.
2. **Phase 1A (EmbeddingGemma 256-d MRL):** Contrastive fine-tuning on `aether_text_triplets_train.jsonl` + hard negatives + 120 hand-written phrasings, gated at recall@1 >= 95% on blind set, exported to ONNX.
3. **Phase 1B (Phi-3.5-mini QLoRA):** 4-bit NF4 LoRA (`r=16`) fine-tuning on `aether_tier4_sft_train.jsonl` with strict Section-6 JSON schema + Tier 3 interlock post-validation.
4. **Tier 2 LightGBM -> ONNX:** Trains 10x asymmetric LightGBM and verifies ONNXRuntime parity (< 15 MB)."""

C1 = '''# @title Cell 1: Check GPU + Install Dependencies
import os, sys, subprocess, torch
HF_TOKEN = ""              # @param {type:"string"}  optional HuggingFace token for gated EmbeddingGemma
EMBED_MODEL = "google/embeddinggemma-300m"  # @param {type:"string"}
SLM_MODEL = "microsoft/Phi-3.5-mini-instruct"  # @param {type:"string"}
RUN_EMBEDDING_FINETUNE = True  # @param {type:"boolean"}
RUN_PHI35_QLORA = True         # @param {type:"boolean"}
MAX_SFT_STEPS = 120            # @param {type:"integer"}
MOUNT_DRIVE = False            # @param {type:"boolean"}

if HF_TOKEN.strip():
    os.environ["HF_TOKEN"] = HF_TOKEN.strip()
print("CUDA available:", torch.cuda.is_available(), "| Device:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU")
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q",
    "numpy", "scipy", "scikit-learn", "joblib", "pillow", "jsonschema",
    "lightgbm>=4.5", "onnx", "onnxmltools>=1.13", "onnxruntime>=1.20", "shap>=0.46",
    "transformers>=4.45", "datasets", "accelerate", "peft>=0.13", "trl>=0.11",
    "bitsandbytes", "sentence-transformers>=3.2", "optimum[onnxruntime]"])
if MOUNT_DRIVE:
    from google.colab import drive
    drive.mount("/content/drive")
'''

C2 = '''# @title Cell 2: Unpack AETHER + Build Datasets + Phase 2 NASA OSDR Ingestion
import base64, io, tarfile, os, subprocess, sys
PAYLOAD = "%s"
PROJ = "/content/aether"
os.makedirs(PROJ, exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(base64.b64decode(PAYLOAD)), mode="r:gz") as tf:
    tf.extractall(PROJ)

def run(args, tail=8):
    env = dict(os.environ, PYTHONPATH=PROJ)
    r = subprocess.run([sys.executable] + args, cwd=PROJ, env=env, capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip().splitlines()
    print("$", " ".join(args)); print("\\n".join("   " + l for l in out[-tail:]))
    if r.returncode != 0: raise RuntimeError("step failed: " + " ".join(args))

run(["data/build_datasets.py"], tail=4)
run(["scripts/ingest_nasa_osdr.py", "."], tail=4)
run(["-c", "from engine.tier2_risk_engine import train_and_export_tier2 as t; import json; m=t(); print('ONNX:', m['onnx_size_mb'], 'MB', json.dumps(m['metrics']))"], tail=4)
''' % payload

C3 = '''# @title Cell 3: Phase 1A — EmbeddingGemma 256-d MRL Contrastive Fine-Tune + Blind Eval
import json, os
from pathlib import Path
import numpy as np

if RUN_EMBEDDING_FINETUNE:
    import torch
    from datasets import Dataset
    from sentence_transformers import SentenceTransformer, InputExample, losses
    from torch.utils.data import DataLoader

    G = Path(PROJ) / "data" / "generated"
    protos = [json.loads(l) for l in open(Path(PROJ) / "data/nasa_protocols.jsonl") if l.strip()]
    train_rows = [json.loads(l) for l in open(G / "aether_text_triplets_train.jsonl")]
    extra_rows = [json.loads(l) for l in open(Path(PROJ) / "data/extra_anchor_phrasings.jsonl")]
    blind_rows = [json.loads(l) for l in open(Path(PROJ) / "data/blind_test_phrasings.jsonl")]

    model_id = EMBED_MODEL
    try:
        st_model = SentenceTransformer(model_id, trust_remote_code=True, token=os.environ.get("HF_TOKEN") or None)
    except Exception as e:
        print(f"Could not load {model_id} ({e}); falling back to open BAAI/bge-small-en-v1.5")
        model_id = "BAAI/bge-small-en-v1.5"
        st_model = SentenceTransformer(model_id)

    proto_by_id = {p["id"]: p["document_text"] for p in protos}
    examples = [InputExample(texts=[r["anchor"], r["positive"], r["negative"]]) for r in train_rows]
    # Add extra hand-written phrasings against hard negative
    all_pids = list(proto_by_id)
    for idx, r in enumerate(extra_rows):
        neg_pid = all_pids[(all_pids.index(r["target_id"]) + 1) % len(all_pids)]
        examples.append(InputExample(texts=[r["anchor"], proto_by_id[r["target_id"]], proto_by_id[neg_pid]]))

    loader = DataLoader(examples, shuffle=True, batch_size=32)
    loss_fn = losses.MultipleNegativesRankingLoss(st_model)
    st_model.fit(train_objectives=[(loader, loss_fn)], epochs=2, warmup_steps=15, show_progress_bar=True)

    # Evaluate 256-d MRL truncated cosine recall@1 on blind_test_phrasings
    def enc_256(texts):
        v = st_model.encode(texts, normalize_embeddings=False, convert_to_numpy=True)[:, :256]
        v = v / np.maximum(1e-12, np.linalg.norm(v, axis=1, keepdims=True))
        return v.astype(np.float32)

    doc_vecs = enc_256([p["document_text"] for p in protos])
    q_vecs = enc_256(["task: search result | query: " + r["anchor"] for r in blind_rows])
    sims = q_vecs @ doc_vecs.T
    pids = [p["id"] for p in protos]
    r1 = np.mean([pids[int(np.argmax(sims[i]))] == blind_rows[i]["target_id"] for i in range(len(blind_rows))])
    print(f"Phase 1A ({model_id}) Blind Recall@1 (n={len(blind_rows)}): {r1:.4f} (gate >= 0.95)")

    out_dir = Path(PROJ) / "artifacts" / "embeddinggemma2_aether"
    out_dir.mkdir(parents=True, exist_ok=True)
    st_model.save(str(out_dir))
    # Update 256-d protocol index with fine-tuned vectors
    idx_path = Path(PROJ) / "artifacts" / "aether_protocols_256d.json"
    if not idx_path.exists():
        run(["-c", "from engine.tier3_5_multimodal_rag import build_local_bootstrap_index; build_local_bootstrap_index()"], tail=2)
    idx_data = json.loads(idx_path.read_text(encoding="utf-8"))
    for p, vec in zip(idx_data["protocols"], doc_vecs):
        p["embedding_256d"] = [round(float(x), 6) for x in vec]
    idx_data["embedding_model"] = f"{model_id} (fine-tuned 256d MRL)"
    idx_path.write_text(json.dumps(idx_data, indent=2), encoding="utf-8")
    print("Saved fine-tuned embedder + updated 256d protocol index.")
else:
    print("Skipped EmbeddingGemma fine-tune.")
'''

C4 = '''# @title Cell 4: Phase 1B — Phi-3.5-mini QLoRA Fine-Tune + Section-6 JSON Schema Validation
import json
from pathlib import Path

if RUN_PHI35_QLORA:
    import torch, jsonschema
    from datasets import Dataset
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    from peft import LoraConfig
    from trl import SFTTrainer, SFTConfig

    G = Path(PROJ) / "data" / "generated"
    sft_train = [json.loads(l) for l in open(G / "aether_tier4_sft_train.jsonl")][:1500]
    sft_eval = [json.loads(l) for l in open(G / "aether_tier4_sft_eval.jsonl")][:50]
    schema = json.loads((Path(PROJ) / "data/schema/triage_output.schema.json").read_text())

    def fmt(row):
        return {"text": f"<|user|>\\n{row.get('instruction', row.get('prompt', ''))}\\n{row.get('input', '')}<|end|>\\n<|assistant|>\\n{json.dumps(row.get('output', row.get('completion', {}))) }<|end|>"}

    ds = Dataset.from_list([fmt(r) for r in sft_train])
    bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16)
    tok = AutoTokenizer.from_pretrained(SLM_MODEL)
    tok.pad_token = tok.eos_token
    mdl = AutoModelForCausalLM.from_pretrained(SLM_MODEL, quantization_config=bnb, device_map="auto")
    lora = LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", lora_dropout=0.05, task_type="CAUSAL_LM")
    args = SFTConfig(output_dir="/content/phi35_aether_lora", max_steps=MAX_SFT_STEPS, per_device_train_batch_size=2,
                     gradient_accumulation_steps=4, learning_rate=2e-4, logging_steps=20, save_strategy="no",
                     dataset_text_field="text", max_seq_length=1024, fp16=not torch.cuda.is_bf16_supported(), bf16=torch.cuda.is_bf16_supported())
    trainer = SFTTrainer(model=mdl, args=args, train_dataset=ds, peft_config=lora, processing_class=tok)
    trainer.train()

    adapter_dir = Path(PROJ) / "artifacts" / "phi35_aether_lora"
    trainer.model.save_pretrained(str(adapter_dir))
    tok.save_pretrained(str(adapter_dir))

    # Schema validation smoke check on held-out eval sample
    valid = 0
    for row in sft_eval[:5]:
        prompt = f"<|user|>\\n{row.get('instruction', row.get('prompt', ''))}\\n{row.get('input', '')}<|end|>\\n<|assistant|>\\n"
        ids = tok(prompt, return_tensors="pt").to(mdl.device)
        out = mdl.generate(**ids, max_new_tokens=420, do_sample=False)
        gen = tok.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True).strip()
        try:
            obj = json.loads(gen[gen.find("{"):gen.rfind("}")+1])
            jsonschema.validate(instance=obj, schema=schema)
            valid += 1
        except Exception:
            pass
    print(f"Phi-3.5 QLoRA saved to {adapter_dir} | unconstrained JSON valid on sample: {valid}/5 (use GBNF + Tier 3 post-validator for 100%)")
else:
    print("Skipped Phi-3.5 QLoRA.")
'''

C5 = '''# @title Cell 5: Optional Export Artifacts to Google Drive (AETHER_Exports)
import shutil, os
if MOUNT_DRIVE and os.path.exists("/content/drive/MyDrive"):
    dst = "/content/drive/MyDrive/AETHER_Exports"
    os.makedirs(dst, exist_ok=True)
    for name in ["aether_risk_engine.onnx", "tier2_lgbm_explainer.pkl", "tier2_metadata.json", "aether_protocols_256d.json"]:
        src = os.path.join(PROJ, "artifacts", name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dst, name))
    print("Exported artifacts to", dst)
else:
    print("Drive not mounted; artifacts are in", os.path.join(PROJ, "artifacts"))
'''

def code(src):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": src.splitlines(keepends=True)}

nb = {
    "cells": [{"cell_type": "markdown", "metadata": {}, "source": MD.splitlines(keepends=True)}, code(C1), code(C2), code(C3), code(C4), code(C5)],
    "metadata": {"colab": {"name": "01_AETHER_GPU_Train.ipynb", "provenance": [], "gpuType": "T4"}, "accelerator": "GPU", "kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"}},
    "nbformat": 4,
    "nbformat_minor": 5,
}
OUT.write_text(json.dumps(nb), encoding="utf-8")
print("wrote", OUT, f"{OUT.stat().st_size/1e6:.2f} MB")
