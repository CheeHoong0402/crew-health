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


# --- minimal Chinese -> English clinical keyword expansion (demo-level; replace with a real multilingual embedder) ---
_ZH = {
    "辐射": "radiation", "太阳": "solar", "耀斑": "solar flare", "质子": "proton flux", "风暴": "storm", "剂量": "dose",
    "二氧化碳": "carbon dioxide CO2", "氧气": "oxygen", "缺氧": "hypoxia low oxygen", "灰尘": "dust", "月尘": "lunar dust", "气压": "cabin pressure", "泄漏": "leak",
    "骨": "bone", "骨密度": "bone density bone loss", "锻炼": "exercise ARED", "运动": "exercise", "肌肉": "muscle", "锁骨": "clavicle", "骨折": "fracture",
    "冲击": "impact jolt", "颠簸": "jolt", "宇航服": "spacesuit suit", "漫游车": "rover LTV", "撞": "impact collision",
    "睡眠": "sleep", "失眠": "insomnia sleep deprivation", "情绪": "mood", "孤独": "isolation", "疲劳": "fatigue", "压力": "stress",
    "血压": "blood pressure", "低血压": "hypotension low blood pressure", "高血压": "hypertension high blood pressure", "心率": "heart rate", "头晕": "dizzy lightheaded presyncope", "晕倒": "syncope faint",
    "血糖": "blood glucose sugar", "低血糖": "hypoglycemia low glucose", "发烧": "fever", "发热": "fever", "感染": "infection", "体温": "temperature",
    "视力": "vision eyesight", "眼": "eye ocular", "视盘": "optic disc papilledema", "颅内压": "intracranial pressure",
    "正常": "nominal normal healthy", "没有异常": "no abnormal findings nominal", "健康": "healthy nominal", "怎么办": "what to do crew actions", "应该": "should",
}


def expand_zh(text: str) -> str:
    """Append English expansions for Chinese clinical keywords so the English retriever can answer basic Chinese questions."""
    if not any("一" <= ch <= "鿿" for ch in text):
        return text
    extra = [en for zh, en in sorted(_ZH.items(), key=lambda kv: -len(kv[0])) if zh in text]
    return text + " " + " ".join(extra)
