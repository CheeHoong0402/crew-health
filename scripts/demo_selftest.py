"""One-command demo check: python3 -I scripts/demo_selftest.py [project_dir]
Runs basic EN/中文 questions through the same code as demo_server and 6 triage presets; prints PASS/FAIL."""
import sys, os, importlib.util, json
from pathlib import Path
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve(); sys.argv = ["x", str(ROOT)]
spec = importlib.util.spec_from_file_location("demo_server", ROOT / "scripts" / "demo_server.py"); ds = importlib.util.module_from_spec(spec); spec.loader.exec_module(ds)
QA = [("CO2 is 4 mmHg in the cabin", "PROTO-ECLSS-01"), ("lunar dust everywhere, people coughing", "PROTO-ECLSS-01"), ("solar flare, protons rising, crew outside", "PROTO-SPE-01"),
      ("blood sugar is 50 and he is shaking", "PROTO-MET-01"), ("fever of 39 degrees", "PROTO-MET-01"), ("blood pressure 85/55 and nearly fainted", "PROTO-CV-01"),
      ("rover jolt 4g, shoulder pain", "PROTO-SUIT-01"), ("bone density dropping, skipped exercise", "PROTO-BONE-02"), ("eyesight getting blurry after 90 days", "PROTO-SANS-01"),
      ("slept 4 hours for three nights, mood very low", "PROTO-MIND-01"), ("everything normal today", "PROTO-NOM-01"), ("lifetime radiation dose near 600 mSv limit", "PROTO-RAD-02"),
      ("太阳耀斑质子风暴，宇航员在外面怎么办", "PROTO-SPE-01"), ("血糖很低，头晕出汗", "PROTO-MET-01"), ("舱内二氧化碳太高", "PROTO-ECLSS-01"), ("血压很低，快要晕倒", "PROTO-CV-01"),
      ("漫游车剧烈颠簸，锁骨疼", "PROTO-SUIT-01"), ("骨密度下降，没有锻炼", "PROTO-BONE-02"), ("连续三晚失眠，情绪低落", "PROTO-MIND-01"), ("一切正常，没有异常", "PROTO-NOM-01")]
ok = 0
for q, want in QA:
    r = ds.ask(q); hit = r["protocol_id"] == want; ok += hit
    print(f"[{'PASS' if hit else 'FAIL'}] {q[:48]:<50} -> {r['protocol_id']:<15} conf={r['confidence']}" + ("" if hit else f"   (expected {want})"))
print(f"\nQ&A: {ok}/{len(QA)} correct")
t_ok = 0
for name, kw in ds.PRESETS.items():
    out = ds.triage(kw); lv = out["triage"]["alert_level"]; exp = "NOMINAL_GREEN" if name == "nominal" else None
    good = (lv == "NOMINAL_GREEN") if name == "nominal" else (lv != "NOMINAL_GREEN"); t_ok += good
    print(f"[{'PASS' if good else 'FAIL'}] triage '{name}': {lv} ({out['diagnostics']['total_ms']} ms)")
print(f"Triage: {t_ok}/{len(ds.PRESETS)}   |   TOTAL {ok+t_ok}/{len(QA)+len(ds.PRESETS)}")
