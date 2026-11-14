"""Lightweight clinical-text helpers (no external deps)."""
import re

_NEG = re.compile(r"\b(without|no|not|never|absent|absence of|rule[sd]? out|ruled out|negative for|denies|free of)\b", re.I)
_STOP = re.compile(r"[.,;:()]| but | however | although ")


def add_negation_tokens(text: str, window: int = 5) -> str:
    """NegEx-style: append NOT_<word> tokens for up to `window` words after a negation cue, so a classifier
    can tell 'without acute proton storm' apart from 'acute proton storm'. Original text is kept."""
    out = []
    low = text.lower()
    for m in _NEG.finditer(low):
        tail = low[m.end():]
        cut = _STOP.search(tail)
        if cut:
            tail = tail[:cut.start()]
        words = re.findall(r"[a-z0-9]+", tail)[:window]
        out.extend("NOT_" + w for w in words)
    return text + (" " + " ".join(out) if out else "")
