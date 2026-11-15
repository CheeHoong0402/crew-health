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


# --- deterministic reading check: numbers in a question vs the plan's Tier-3 limits (md Sec.4) ---
_N = r"(\d+(?:\.\d+)?)"
def reading_hints(text: str):
    """Return [(protocol_id, reason, severity_rank)] for readings in free text that cross plan thresholds. Most severe first."""
    t = text.lower(); out = []
    def last(p):
        m = re.search(p, t); return float(m.group(1)) if m else None
    co2_match = re.search(r"(?:co2|co₂|ppco2|二氧化碳)[^\d]{0,15}" + _N + r"\s*(ppm|mmhg)?", t)
    # ppm needs total pressure to derive partial pressure; never treat it as mmHg.
    co2 = float(co2_match.group(1)) if co2_match and co2_match.group(2) != "ppm" else None
    if co2 is not None:
        if co2 > 3.0: out.append(("PROTO-ECLSS-01", f"CO2 {co2} mmHg > 3.0 limit", 2))
        elif co2 > 2.5: out.append(("PROTO-SANS-01", f"CO2 {co2} mmHg > 2.5 (SANS watch)", 1))
    o2 = last(r"(?:oxygen|o2|氧气?)[^\d]{0,15}" + _N)
    if o2 is not None and 5 < o2 < 19.5: out.append(("PROTO-ECLSS-01", f"O2 {o2}% < 19.5", 2))
    dust = last(r"(?:dust|灰尘|月尘)[^\d]{0,15}" + _N)
    if dust is not None and dust > 0.3: out.append(("PROTO-ECLSS-01", f"dust {dust} mg/m3 > 0.3", 2))
    glu = last(r"(?:glucose|blood sugar|sugar|血糖)[^\d]{0,15}" + _N)
    if glu is not None and (glu < 70 or glu > 250): out.append(("PROTO-MET-01", f"glucose {glu} outside 70-250", 2))
    tmp = last(r"(?:temp(?:erature)?|fever|体温|发烧|发热)[^\d]{0,15}" + _N)
    if tmp is not None and 30 < tmp < 45 and tmp > 38.5: out.append(("PROTO-MET-01", f"temperature {tmp} C > 38.5", 2))
    m = re.search(r"(\d{2,3})\s*/\s*(\d{2,3})", t)
    if m:
        s, d = float(m.group(1)), float(m.group(2))
        if 50 < s < 260 and 30 < d < 160 and (s < 90 or d < 60 or s > 160 or d > 100): out.append(("PROTO-CV-01", f"BP {s:.0f}/{d:.0f} outside limits", 2))
    hr = last(r"(?:heart rate|pulse|心率|\bhr\b)[^\d]{0,15}" + _N)
    if hr is not None and 120 < hr < 260: out.append(("PROTO-CV-01", f"heart rate {hr} > 120", 2))
    fl = last(r"(?:proton|flux|pfu|质子)[^\d]{0,15}" + _N)
    if fl is not None and fl > 10: out.append(("PROTO-SPE-01", f"proton flux {fl} pfu > 10", 2))
    ds = last(_N + r"\s*(?:usv|µsv|μsv)")
    if ds is not None and ds > 100: out.append(("PROTO-SPE-01", f"dose rate {ds} uSv/hr > 100", 2))
    g = last(_N + r"\s*g\b") if re.search(r"jolt|rover|impact|bump|collision|颠簸|冲击|漫游车|撞", t) else None
    if g is not None and 2.5 < g < 30: out.append(("PROTO-SUIT-01", f"jolt {g} g > 2.5", 2))
    sl = last(r"(?:slept|sleep|睡眠|睡)[^\d]{0,12}" + _N + r"\s*(?:h|hr|hrs|hours|小时)")
    if sl is not None and sl < 5.5: out.append(("PROTO-MIND-01", f"sleep {sl} h < 5.5", 1))
    return sorted(out, key=lambda x: -x[2])
