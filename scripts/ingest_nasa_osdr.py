"""Phase 2 Real-Data Ingestion: NASA OSDR Study Metadata + NOAA SWPC Space Weather.

Fetches real longitudinal/spaceflight study baselines from the public NASA Open
Science Data Repository (OSDR) API and live GOES solar proton/X-ray telemetry from
NOAA SWPC, saving structured artifacts under `data/generated/` for RAG grounding
and baseline calibration. Uses stdlib only; degrades gracefully offline.

Usage:
    python3 scripts/ingest_nasa_osdr.py [project_dir]
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "generated"

OSDR_STUDY_IDS = ["48", "53", "174", "310", "661", "73"]
OSDR_META_URL = "https://osdr.nasa.gov/osdr/data/osd/meta/{sid}"
OSDR_SEARCH_URL = "https://osdr.nasa.gov/osdr/data/search?term={term}&size=5&from=0"
NOAA_PROTONS_URL = "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json"
NOAA_XRAYS_URL = "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json"

HEADERS = {"User-Agent": "Project-AETHER/1.0 (Autonomous Flight Surgeon AI)"}


def _fetch_json(url: str, timeout: int = 15) -> Optional[Any]:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def _comment_map(study_obj: Dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for item in study_obj.get("comments", []):
        name = str(item.get("name", "")).strip()
        val = str(item.get("value", "")).strip()
        if name and val:
            out[name] = val
    return out


def fetch_osdr_study(sid: str) -> Optional[Dict[str, Any]]:
    data = _fetch_json(OSDR_META_URL.format(sid=sid))
    if not data:
        return None
    key = f"OSD-{sid}"
    studies = data.get("study", {}).get(key, {}).get("studies", [])
    if not studies:
        return None
    s = studies[0]
    comments = _comment_map(s)
    return {
        "accession": key,
        "title": s.get("title", "").strip(),
        "description": s.get("description", "").strip()[:600],
        "factors": [f.get("factorName") for f in s.get("factors", []) if f.get("factorName")],
        "assay_count": len(s.get("assays", [])),
        "flight_program": comments.get("Flight Program", ""),
        "experiment_platform": comments.get("Experiment Platform", ""),
        "doi": comments.get("DOI", ""),
        "source_url": f"https://osdr.nasa.gov/bio/repo/data/studies/{key}",
    }


def fetch_noaa_space_weather() -> Dict[str, Any]:
    protons = _fetch_json(NOAA_PROTONS_URL) or []
    xrays = _fetch_json(NOAA_XRAYS_URL) or []

    latest_p10 = None
    for row in reversed(protons):
        if row.get("energy") == ">=10 MeV" and row.get("flux") is not None:
            latest_p10 = {
                "time_tag": row.get("time_tag"),
                "flux_pfu": float(row["flux"]),
                "satellite": row.get("satellite"),
            }
            break

    latest_xray = None
    for row in reversed(xrays):
        if row.get("energy") == "0.1-0.8nm" and row.get("flux") is not None:
            latest_xray = {
                "time_tag": row.get("time_tag"),
                "flux_wm2": float(row["flux"]),
                "satellite": row.get("satellite"),
            }
            break

    return {
        "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "goes_proton_10mev": latest_p10,
        "goes_xray_long": latest_xray,
    }


def ingest_all(out_dir: Path = OUT_DIR) -> Dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    studies: List[Dict[str, Any]] = []
    for sid in OSDR_STUDY_IDS:
        st = fetch_osdr_study(sid)
        if st:
            studies.append(st)

    search_hits: List[Dict[str, str]] = []
    for term in ("astronaut", "spaceflight"):
        res = _fetch_json(OSDR_SEARCH_URL.format(term=urllib.parse.quote(term)))
        if res:
            for hit in res.get("hits", {}).get("hits", []):
                src = hit.get("_source", {})
                acc = str(src.get("Accession", "")).strip()
                if acc and not any(x["accession"] == acc for x in search_hits):
                    search_hits.append({
                        "accession": acc,
                        "title": str(src.get("Study Title", "")).strip(),
                        "organism": str(src.get("organism", "")).strip(),
                    })

    space_weather = fetch_noaa_space_weather()

    payload = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "NASA OSDR Public API + NOAA SWPC GOES Primary",
        "osdr_studies": studies,
        "osdr_search_discoveries": search_hits,
        "live_space_weather": space_weather,
    }
    baselines_path = out_dir / "nasa_osdr_baselines.json"
    baselines_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    corpus_path = out_dir / "aether_osdr_corpus.jsonl"
    with corpus_path.open("w", encoding="utf-8") as f:
        for st in studies:
            doc = {
                "id": st["accession"],
                "title": st["title"],
                "factors": st["factors"],
                "flight_program": st["flight_program"],
                "document_text": f"title: {st['accession']} {st['title']} | text: Factors: {', '.join(st['factors'])}. {st['description']}",
                "source_url": st["source_url"],
            }
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")

    return payload


if __name__ == "__main__":
    summary = ingest_all()
    print(
        f"OSDR studies fetched: {len(summary['osdr_studies'])}, "
        f"search discoveries: {len(summary['osdr_search_discoveries'])}, "
        f"NOAA proton={summary['live_space_weather'].get('goes_proton_10mev')}"
    )
