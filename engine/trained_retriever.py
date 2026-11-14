"""Trained (non-neural) Tier 3.5 retrievers: text -> protocol probabilities, scan image -> finding probabilities.
Trained by scripts/train_retrievers.py; run on CPU in ~1 ms. Replace/blend with fine-tuned EmbeddingGemma when GPU-trained."""
from __future__ import annotations
from pathlib import Path
from typing import Dict, List
import numpy as np
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from PIL import Image
from engine.text_utils import add_negation_tokens

ART = Path(__file__).resolve().parent.parent / "artifacts"


class TextClf:
    def __init__(self, C: float = 20.0):
        self.w = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1)
        self.c = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=2)
        self.lr = LogisticRegression(C=C, max_iter=2000)

    def _f(self, X: List[str], fit: bool = False):
        X = [add_negation_tokens(x) for x in X]
        if fit:
            return hstack([self.w.fit_transform(X), self.c.fit_transform(X)]).tocsr()
        return hstack([self.w.transform(X), self.c.transform(X)]).tocsr()

    def fit(self, X, y, sw=None):
        self.lr.fit(self._f(X, True), y, sample_weight=sw)
        self.classes_ = self.lr.classes_
        return self

    def predict_proba(self, X):
        return self.lr.predict_proba(self._f(X))

    def proba_dict(self, text: str) -> Dict[str, float]:
        return dict(zip(self.classes_, self.predict_proba([text])[0]))


def image_features(im: Image.Image) -> np.ndarray:
    from engine.tier3_5_multimodal_rag import compute_image_signature_256d
    im = im.convert("RGB")
    th = np.asarray(im.resize((24, 24), Image.Resampling.BILINEAR), np.float32).ravel() / 255.0
    return np.concatenate([compute_image_signature_256d(im), th])
