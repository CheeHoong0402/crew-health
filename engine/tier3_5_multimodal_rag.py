"""
Tier 3.5 — Offline Multimodal Retrieval Engine (EmbeddingGemma 2 Text + Vision, 256d MRL).

Zero PyTorch dependency at inference time:
  - When Colab-exported ONNX weights exist under `artifacts/embeddinggemma2_aether/`,
    runs `text_encoder*.onnx` (`task: search result | query: ` prefix) and
    `vision_encoder*.onnx` (NO text prefix on images) with `onnxruntime` + `tokenizers`,
    truncating embeddings to 256d Matryoshka vectors and L2-normalizing.
  - When ONNX weights are not yet present locally, cleanly falls back to the
    pre-computed 256d index + deterministic 256d hybrid clinical/visual signature
    projector so offline triage and scan tests run out-of-the-box.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

from engine.tier1_hbm_physics import HBMState, TelemetryInput
from engine.tier3_safety_interlock import SafetyInterlockResult

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
ARTIFACTS_DIR = ROOT_DIR / "artifacts"
DEFAULT_PROTOCOLS_PATH = DATA_DIR / "nasa_protocols.jsonl"
DEFAULT_INDEX_PATH = ARTIFACTS_DIR / "aether_protocols_256d.json"
DEFAULT_ONNX_DIR = ARTIFACTS_DIR / "embeddinggemma2_aether"

RETRIEVAL_QUERY_PREFIX = "task: search result | query: "
MRL_DIM = 256


@dataclass
class RetrievalMatch:
    protocol_id: str
    title: str
    syndrome_code: str
    severity: str
    similarity: float
    matched_modality: str
    protocol: Dict


def _l2_normalize(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    if norm <= 1e-12:
        out = np.zeros_like(vec, dtype=np.float32)
        out[0] = 1.0
        return out
    return (vec / norm).astype(np.float32)


def _signed_hash_text_embedding_256d(text: str) -> np.ndarray:
    """Deterministic 256d random-projection subword+token embedding for offline fallback."""
    vec = np.zeros(MRL_DIM, dtype=np.float32)
    cleaned = re.sub(r"[^a-z0-9_]+", " ", text.lower()).strip()
    tokens = cleaned.split()
    grams: List[Tuple[str, float]] = []
    for tok in tokens:
        grams.append((tok, 1.4))
        if len(tok) >= 4:
            for i in range(len(tok) - 2):
                grams.append((tok[i : i + 3], 0.45))
    for i in range(len(tokens) - 1):
        grams.append((f"{tokens[i]}_{tokens[i+1]}", 1.1))

    for g, weight in grams:
        digest = hashlib.blake2b(g.encode("utf-8"), digest_size=8).digest()
        h_int = int.from_bytes(digest, "little")
        idx1 = h_int % MRL_DIM
        sign1 = 1.0 if ((h_int >> 8) & 1) else -1.0
        idx2 = (h_int >> 16) % MRL_DIM
        sign2 = 1.0 if ((h_int >> 24) & 1) else -1.0
        vec[idx1] += sign1 * weight
        vec[idx2] += sign2 * (0.5 * weight)
    return _l2_normalize(vec)


def compute_image_signature_256d(image: Image.Image) -> np.ndarray:
    """
    Compact deterministic 256d visual-descriptor vector capturing clinical scan cues
    (central vs peripheral luminance, erythema red dominance, horizontal line PSD, edge sharpness)
    for local verification when vision_encoder.onnx has not been copied from Colab yet.
    """
    im = image.convert("RGB").resize((112, 112), Image.Resampling.BILINEAR)
    arr = np.asarray(im, dtype=np.float32) / 255.0  # (112, 112, 3)

    # Spatial 4x4 grid RGB means + stds (16 * 6 = 96 dims)
    grid_feats: List[float] = []
    step = 28
    for gy in range(4):
        for gx in range(4):
            patch = arr[gy * step : (gy + 1) * step, gx * step : (gx + 1) * step]
            grid_feats.extend(patch.mean(axis=(0, 1)).tolist())
            grid_feats.extend(patch.std(axis=(0, 1)).tolist())

    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    gray = 0.299 * r + 0.587 * g + 0.114 * b

    # Center disc vs perimeter brightness + sharpness (papilledema vs normal fundus)
    center = arr[36:76, 36:76]
    outer = arr[8:28, 8:28]
    dx = np.abs(np.diff(gray, axis=1))
    dy = np.abs(np.diff(gray, axis=0))
    row_means = gray[48:, :].mean(axis=1)
    row_osc = float(np.std(np.diff(row_means))) if len(row_means) > 2 else 0.0
    mid_band = gray[42:70, :]
    mid_gap_contrast = float(np.max(mid_band.mean(axis=0)) - np.min(mid_band.mean(axis=0)))

    domain_cues = [
        float(r.mean() - 0.5 * (g.mean() + b.mean())) * 2.5,  # erythema redness ratio
        float(((r - g) > 0.28).mean()) * 5.0,  # acute demarcated radiation erythema area
        float(g.std()) * 4.5,  # spatial heterogeneity vs smooth normal skin
        float(center.mean()),
        float(outer.mean()),
        float(center[:, :, 1].mean() - center[:, :, 2].mean()),  # yellow disc prominence
        float(dx.mean()),
        float(dy.mean()),
        float(dy.mean() / (dx.mean() + 1e-4)),  # horizontal ultrasound B-line ratio
        row_osc * 10.0,
        mid_gap_contrast * 3.0,
        float((gray < 0.15).mean()),  # dark bezel / bone X-ray background fraction
        float((gray > 0.80).mean()),  # cortical bone / disc core fraction
    ]

    # Repeat-pack and normalize cleanly to 256 dims
    raw = np.zeros(MRL_DIM, dtype=np.float32)
    raw[: len(grid_feats)] = grid_feats
    base = len(grid_feats)
    for k, val in enumerate(domain_cues):
        raw[base + k] = val * 2.5
    # Fill remaining dims with 16-bin grayscale & RG histograms
    hist_g, _ = np.histogram(gray, bins=32, range=(0.0, 1.0), density=True)
    hist_rg, _ = np.histogram(np.clip(r - g, -1.0, 1.0), bins=32, range=(-1.0, 1.0), density=True)
    raw[base + len(domain_cues) : base + len(domain_cues) + 32] = hist_g.astype(np.float32) * 0.25
    raw[base + len(domain_cues) + 32 : base + len(domain_cues) + 64] = hist_rg.astype(np.float32) * 0.25
    return _l2_normalize(raw)


def _find_first(directory: Path, candidates: Sequence[str]) -> Optional[Path]:
    for name in candidates:
        p = directory / name
        if p.exists():
            return p
    return None


def build_local_bootstrap_index(
    protocols_path: Path = DEFAULT_PROTOCOLS_PATH,
    index_out: Path = DEFAULT_INDEX_PATH,
) -> Dict:
    """Create a deterministic 256d index + scan prototype bank until Colab exports EmbeddingGemma 2 weights."""
    protocols: List[Dict] = []
    with protocols_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                protocols.append(json.loads(line))

    # Build visual scan prototypes if generated phantom images exist locally
    scan_dir = DATA_DIR / "generated" / "scan_images"
    scan_prototypes: List[Dict] = []
    scan_to_proto = {
        "ocular_fundus_sans": ("PROTO-SANS-01", "ABNORMAL_SANS_PAPILLEDEMA"),
        "ocular_fundus_normal": ("PROTO-NOM-01", "NORMAL_OCULAR_FUNDUS"),
        "skin_erythema_radiation": ("PROTO-SPE-01", "ABNORMAL_RADIATION_ERYTHEMA"),
        "skin_normal": ("PROTO-NOM-01", "NORMAL_DERMAL_BASELINE"),
        "thoracic_ultrasound_pneumothorax": ("PROTO-ECLSS-01", "ABNORMAL_THORACIC_ULTRASOUND"),
        "thoracic_ultrasound_normal": ("PROTO-NOM-01", "NORMAL_THORACIC_ULTRASOUND"),
        "bone_clavicle_fracture": ("PROTO-SUIT-01", "ABNORMAL_CLAVICLE_FRACTURE"),
        "bone_clavicle_intact": ("PROTO-NOM-01", "NORMAL_CLAVICLE_CORTEX"),
    }
    if scan_dir.exists():
        for prefix, (pid, label) in scan_to_proto.items():
            sample_paths = sorted(scan_dir.glob(f"{prefix}_*.png"))[:12]
            if not sample_paths:
                continue
            vecs = []
            for sp in sample_paths:
                with Image.open(sp) as im:
                    vecs.append(compute_image_signature_256d(im))
            centroid = _l2_normalize(np.mean(np.stack(vecs, axis=0), axis=0))
            scan_prototypes.append({
                "scan_kind": prefix,
                "protocol_id": pid,
                "clinical_finding": label,
                "embedding_256d": [round(float(v), 6) for v in centroid],
            })

    records = []
    for p in protocols:
        vec = _signed_hash_text_embedding_256d(p["document_text"])
        rec = dict(p)
        rec["embedding_256d"] = [round(float(v), 6) for v in vec]
        records.append(rec)

    payload = {
        "schema_version": "aether-index-v1",
        "embedding_model": "local-bootstrap-hybrid-256d (replace with Notebook 1 Colab EmbeddingGemma-2 ONNX export)",
        "embedding_backend": "local_bootstrap_256d",
        "mrl_dim": MRL_DIM,
        "protocols": records,
        "scan_prototypes": scan_prototypes,
    }
    index_out.parent.mkdir(parents=True, exist_ok=True)
    with index_out.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return payload


class Tier35MultimodalRAG:
    """Offline 256d MRL multimodal retriever (Text + Medical Scan Images)."""

    def __init__(
        self,
        index_path: Path = DEFAULT_INDEX_PATH,
        onnx_dir: Path = DEFAULT_ONNX_DIR,
    ) -> None:
        self.index_path = index_path
        self.onnx_dir = onnx_dir

        if not index_path.exists():
            build_local_bootstrap_index(index_out=index_path)

        with index_path.open("r", encoding="utf-8") as f:
            self.index_data = json.load(f)

        self.protocols: List[Dict] = self.index_data["protocols"]
        self.proto_by_id: Dict[str, Dict] = {p["id"]: p for p in self.protocols}
        self.doc_matrix = np.asarray(
            [p["embedding_256d"] for p in self.protocols], dtype=np.float32
        )
        # Re-normalize row-wise cleanly
        norms = np.linalg.norm(self.doc_matrix, axis=1, keepdims=True)
        norms = np.where(norms > 1e-12, norms, 1.0)
        self.doc_matrix = self.doc_matrix / norms

        self.scan_prototypes: List[Dict] = self.index_data.get("scan_prototypes", [])
        if self.scan_prototypes:
            self.scan_matrix = np.asarray(
                [sp["embedding_256d"] for sp in self.scan_prototypes], dtype=np.float32
            )
            sn = np.linalg.norm(self.scan_matrix, axis=1, keepdims=True)
            sn = np.where(sn > 1e-12, sn, 1.0)
            self.scan_matrix = self.scan_matrix / sn
        else:
            self.scan_matrix = None

        self.text_sess = None
        self.vision_sess = None
        self.tokenizer = None
        self.vision_size = 224
        self.vision_mean = np.asarray([0.5, 0.5, 0.5], dtype=np.float32).reshape(1, 3, 1, 1)
        self.vision_std = np.asarray([0.5, 0.5, 0.5], dtype=np.float32).reshape(1, 3, 1, 1)
        self.backend_name = self.index_data.get("embedding_backend", "local_bootstrap_256d")
        self._try_load_onnx_weights()
        self.text_clf = None
        self.scan_clf = None
        self.kind2pid: Dict[str, str] = {}
        try:  # trained CPU retrievers (scripts/train_retrievers.py); optional
            import joblib
            tp = Path(index_path).parent / "rag_text_clf.joblib"
            sp = Path(index_path).parent / "scan_clf.joblib"
            if tp.exists():
                self.text_clf = joblib.load(tp)["model"]
            if sp.exists():
                d = joblib.load(sp)
                self.scan_clf, self.kind2pid = d["model"], d["kind2pid"]
        except Exception:
            self.text_clf = self.scan_clf = None

    def _try_load_onnx_weights(self) -> None:
        if not self.onnx_dir.exists():
            return
        text_onnx = _find_first(
            self.onnx_dir,
            ("text_encoder_q4.onnx", "text_encoder_q8.onnx", "text_encoder.onnx", "model_q4.onnx", "model_q8.onnx", "model.onnx"),
        )
        tok_file = _find_first(self.onnx_dir, ("tokenizer.json",))
        if text_onnx and tok_file:
            try:
                import onnxruntime as ort
                from tokenizers import Tokenizer

                self.text_sess = ort.InferenceSession(str(text_onnx), providers=["CPUExecutionProvider"])
                self.tokenizer = Tokenizer.from_file(str(tok_file))
                self.backend_name = f"embeddinggemma2_onnx ({text_onnx.name})"
            except Exception:
                self.text_sess = None
                self.tokenizer = None

        vis_onnx = _find_first(
            self.onnx_dir,
            ("vision_encoder_q4.onnx", "vision_encoder_q8.onnx", "vision_encoder.onnx"),
        )
        if vis_onnx:
            try:
                import onnxruntime as ort

                self.vision_sess = ort.InferenceSession(str(vis_onnx), providers=["CPUExecutionProvider"])
                cfg_file = _find_first(self.onnx_dir, ("vision_config.json", "preprocessor_config.json"))
                if cfg_file:
                    cfg = json.loads(cfg_file.read_text(encoding="utf-8"))
                    sz = cfg.get("size", {})
                    if isinstance(sz, dict):
                        self.vision_size = int(sz.get("height", sz.get("shortest_edge", 224)))
                    elif isinstance(sz, int):
                        self.vision_size = sz
                    if "image_mean" in cfg and "image_std" in cfg:
                        self.vision_mean = np.asarray(cfg["image_mean"], dtype=np.float32).reshape(1, 3, 1, 1)
                        self.vision_std = np.asarray(cfg["image_std"], dtype=np.float32).reshape(1, 3, 1, 1)
            except Exception:
                self.vision_sess = None

    def embed_text(self, text: str, is_query: bool = True) -> np.ndarray:
        """Return 256d MRL unit-normalized vector for text query or document."""
        formatted = f"{RETRIEVAL_QUERY_PREFIX}{text}" if is_query and not text.startswith("title:") else text
        if self.text_sess is not None and self.tokenizer is not None:
            enc = self.tokenizer.encode(formatted)
            ids = np.asarray([enc.ids[:512]], dtype=np.int64)
            mask = np.asarray([enc.attention_mask[:512]], dtype=np.int64)
            input_names = {inp.name for inp in self.text_sess.get_inputs()}
            feed: Dict[str, np.ndarray] = {"input_ids": ids}
            if "attention_mask" in input_names:
                feed["attention_mask"] = mask
            outs = self.text_sess.run(None, feed)
            emb = np.asarray(outs[0], dtype=np.float32)
            if emb.ndim == 3:
                # Mean pool across sequence axis if raw hidden state returned
                m = mask[:, :, None].astype(np.float32)
                emb = (emb * m).sum(axis=1) / np.maximum(1.0, m.sum(axis=1))
            return _l2_normalize(emb[0, :MRL_DIM])
        return _signed_hash_text_embedding_256d(formatted)

    def embed_image(self, image: Image.Image) -> np.ndarray:
        """
        Return 256d MRL unit-normalized vector for a clinical scan image.
        IMPORTANT: Never applies a text prefix to image inputs.
        """
        if self.vision_sess is not None:
            im = image.convert("RGB").resize((self.vision_size, self.vision_size), Image.Resampling.BICUBIC)
            arr = (np.asarray(im, dtype=np.float32) / 255.0).transpose(2, 0, 1)[None, ...]
            pixel_values = (arr - self.vision_mean) / self.vision_std
            inp_name = self.vision_sess.get_inputs()[0].name
            outs = self.vision_sess.run(None, {inp_name: pixel_values.astype(np.float32)})
            emb = np.asarray(outs[0], dtype=np.float32)
            if emb.ndim == 3:
                emb = emb.mean(axis=1)
            return _l2_normalize(emb[0, :MRL_DIM])
        return compute_image_signature_256d(image)

    def build_telemetry_query(
        self,
        t: TelemetryInput,
        hbm: HBMState,
        interlock: SafetyInterlockResult,
    ) -> str:
        parts = []
        if t.symptom_notes.strip():
            parts.append(t.symptom_notes.strip())
        if interlock.detected_syndromes:
            parts.append("Syndromes: " + ", ".join(interlock.detected_syndromes))
        parts.append(
            f"Location {t.habitat_location}. Vitals BP {t.systolic_bp_mmhg:.0f}/{t.diastolic_bp_mmhg:.0f}, "
            f"HR {t.resting_hr_bpm:.0f} (+{t.hr_baseline_7d_delta_pct:.0f}%), "
            f"glucose {t.blood_glucose_mg_dl:.0f}, temp {t.core_temp_c:.1f}C, "
            f"ppCO2 {t.cabin_ppco2_mmhg:.2f} mmHg, dust {t.airborne_dust_mg_m3:.2f}, "
            f"proton flux {t.goes_proton_flux_pfu:.1f} pfu, dosimeter {t.dosimeter_rate_usv_hr:.0f} uSv/hr, "
            f"LTV jolt {t.ltv_imu_peak_g:.1f}g, bone retention {hbm.bone_mass_retention_pct:.1f}%, "
            f"shoulder clearance {hbm.effective_hut_shoulder_clearance_mm:.1f} mm, sleep {t.sleep_hours_3d_avg:.1f}h"
        )
        return " ".join(parts)

    def match_scan_image(self, image: Image.Image) -> Dict[str, object]:
        """Match an uploaded medical scan image to closest scan finding + NASA protocol."""
        if self.scan_clf is not None and self.vision_sess is None:
            from engine.trained_retriever import image_features
            pr = self.scan_clf.predict_proba([image_features(image)])[0]
            k = int(np.argmax(pr)); kind = str(self.scan_clf.classes_[k])
            finding = next((sp["clinical_finding"] for sp in self.scan_prototypes if sp["scan_kind"] == kind), kind.upper())
            return {
                "matched_scan_kind": kind,
                "clinical_finding": finding,
                "protocol_id": self.kind2pid[kind],
                "similarity": round(float(pr[k]), 4),
                "backend": "trained_scan_classifier",
            }
        img_vec = self.embed_image(image)
        if self.vision_sess is not None or self.scan_matrix is None or len(self.scan_prototypes) == 0:
            # Compare neural embedding directly against protocol document embeddings
            sims = self.doc_matrix @ img_vec
            best_idx = int(np.argmax(sims))
            proto = self.protocols[best_idx]
            return {
                "matched_scan_kind": proto.get("scan_modality", "unknown"),
                "clinical_finding": proto["syndrome_code"],
                "protocol_id": proto["id"],
                "similarity": round(float(sims[best_idx]), 4),
                "backend": self.backend_name,
            }

        proto_sims = self.scan_matrix @ img_vec
        best_idx = int(np.argmax(proto_sims))
        best = self.scan_prototypes[best_idx]
        return {
            "matched_scan_kind": best["scan_kind"],
            "clinical_finding": best["clinical_finding"],
            "protocol_id": best["protocol_id"],
            "similarity": round(float(proto_sims[best_idx]), 4),
            "backend": self.backend_name,
        }

    def retrieve(
        self,
        query_text: str,
        scan_image: Optional[Image.Image] = None,
        interlock_protocol_ids: Optional[Sequence[str]] = None,
        top_k: int = 3,
    ) -> Tuple[List[RetrievalMatch], Optional[Dict[str, object]]]:
        q_vec = self.embed_text(query_text, is_query=True)
        scores = (self.doc_matrix @ q_vec).astype(np.float32)

        if self.text_clf is not None:  # blend trained text->protocol probabilities (weight 0.6)
            pd = self.text_clf.proba_dict(query_text)
            for i, p in enumerate(self.protocols):
                scores[i] += 0.6 * float(pd.get(p["id"], 0.0))

        scan_match: Optional[Dict[str, object]] = None
        if scan_image is not None:
            scan_match = self.match_scan_image(scan_image)
            scan_pid = str(scan_match["protocol_id"])
            for i, p in enumerate(self.protocols):
                if p["id"] == scan_pid and scan_pid != "PROTO-NOM-01":
                    scores[i] += 0.55

        # Boost protocols flagged by deterministic Tier 3 NASA-STD-3001 interlock
        if interlock_protocol_ids:
            boost_set = set(interlock_protocol_ids)
            for i, p in enumerate(self.protocols):
                if p["id"] in boost_set:
                    scores[i] += 0.45

        order = np.argsort(-scores)[: max(top_k, 4)]
        matches: List[RetrievalMatch] = []
        for idx in order:
            p = self.protocols[int(idx)]
            matches.append(
                RetrievalMatch(
                    protocol_id=p["id"],
                    title=p["title"],
                    syndrome_code=p["syndrome_code"],
                    severity=p["severity"],
                    similarity=round(float(scores[int(idx)]), 4),
                    matched_modality="text+vision" if scan_image is not None else "text",
                    protocol=p,
                )
            )
        return matches, scan_match
