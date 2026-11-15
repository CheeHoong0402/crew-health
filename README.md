# Project AETHER — Autonomous Flight Surgeon AI (crew-health)

4-tier offline health-monitoring pipeline (Tier 1 HBM physics, Tier 2 anomaly ML, Tier 3 NASA-STD-3001 interlock,
Tier 3.5 multimodal RAG, Tier 4 Section-6 JSON). Spec: `docs/architecture_plan.md`. Results: `docs/REPORT.md`.

    python3 data/build_datasets.py          # (from repo root, with PYTHONPATH=.) generate 25k scenarios + SFT/triplet data
    python3 scripts/tune_eval.py .          # tune Tier 2, evaluate accuracy/speed, writes artifacts/tier2_hgb_tuned.joblib
    python3 scripts/plan_conformance.py .   # threshold-by-threshold check against the plan
    python3 scripts/demo_smoke_test.py .    # scenario demo
    python3 scripts/train_retrievers.py .   # trained text/scan retrievers (artifacts/rag_text_clf, scan_clf)
    python3 scripts/train_temporal_tier2.py .  # temporal early-warning model (artifacts/tier2_temporal)
    python3 scripts/oracle_check.py .       # independent test vs md thresholds

**API / Colab deploy:** `scripts/make_colab_notebook.py` builds `04_AETHER_Deploy_API.ipynb` (API key, public link, MCP endpoint); see `DEMO.md`.

**Demo:** see `DEMO.md` (`scripts/demo_selftest.py` = one-command check, `scripts/demo_server.py` = web/API demo, stdlib only).

Tier 2 uses LightGBM->ONNX when available, else `engine/tier2_sklearn_fallback.py`.
Safety: research prototype, not a medical device. Thresholds must be validated by flight-surgeon review.

Policy: only the deterministic Tier 3 interlock (and abnormal scans) set the alert level; ML models are advisory
(`ML_CAN_ESCALATE_TO_RED/AMBER = False` in `engine/tier4_action_slm.py`). Optional `history=` on `AetherPipeline.run()` returns an early-warning score.

---

# Crew Health

Offline astronaut health monitoring demo based on the supplied challenge brief. Use artificial data for judging. Run `npm start`, then open http://127.0.0.1:4173. No dependency installation is needed. Run `npm test`.

Run with Node.js using `npm start`, then open http://127.0.0.1:4173. Vendored browser assets are included. Use `npm ci` when updating development dependencies. Run checks with `npm test`.

Use [astronaut-health-data.csv](data/testing/astronaut-health-data.csv). It has **exactly 27 columns: record_id, timestamp and all 25 supported device measurements**. Each row is a timestamp record, and each measurement value appears under its own column. There are no quantity, value, unit, instrument-configuration or workflow columns in the primary template or standard download. Units are fixed in the application, not recorded per row.

The example contains 19 unique timestamps and 92 populated measurement cells. Blank cells mean no reading; zero stays zero. `data/testing` contains this primary sample plus `astronaut-health-stable.csv` and `astronaut-health-worsening.csv`. The import dialog’s fictional-dataset dropdown previews all three. They share 27 columns, 19 timestamps, 92 measurements and the same seven-day window. Stable readings stay within the configured demo references, while worsening readings show declining sleep and rising pulse, pressure, temperature and glucose. Each import creates a separate synthetic profile with a scenario label for comparison. Duplicate device downloads and unused standalone health test datasets have been removed. The complete manual-entry example and required compatibility fixtures live in `data/fixtures`; the editor and automated checks load them there. Older uploaded CSV contracts remain supported.

For judging, open **Astronaut profile & data → Auto · Import CSV → Compare fictional 7-day datasets → choose a sample → Import validated rows**. The dashboard opens a separate fictional crew profile with days 55–61, two short nights, an elevated temperature and a high cabin CO₂ sample. To use your own file, choose it instead. Under **Measurement context**, set the mission, astronaut, cabin and mission day of the latest timestamp. Earlier UTC dates retain their spacing. Choose **Observed mission records** for measured data; observed missions must be separate from synthetic ones.

For example, a file may include only the measurements it actually supplies:

```csv
record_id,timestamp,heart_rate,co2,diastolic_pressure
RECORD-001,2026-12-03T08:00:00Z,68,1200,76
RECORD-002,2026-12-03T08:01:00Z,72,1300,78
```

Use ISO UTC timestamps with seconds. `CO2` is accepted as an alias for `co2`. Record IDs use 1–60 letters, digits, dots, underscores or hyphens. Combine measurements at each timestamp into one row. A file must contain at least one populated measurement column. All numeric values must be finite nonnegative decimals. UTF-8, quoted cells, BOM and CRLF are supported, with a 1 MiB / 1,000 timestamp-row limit.

| Measurement column | Fixed unit |
|---|---|
| heart_rate | bpm |
| systolic_pressure | mmHg |
| diastolic_pressure | mmHg |
| body_temperature | degC |
| oxygen_saturation | percent |
| respiratory_rate | breaths/min |
| blood_glucose | mg/dL |
| fluid_intake | mL/24h |
| urine_specific_gravity | ratio |
| sleep_hours | h |
| visual_acuity_decimal | decimal |
| lumbar_bone_mineral_density | g/cm2 |
| grip_strength | kgf |
| completed_duration | min |
| balance_task_duration | s |
| white_blood_cell_count | 10^9/L |
| surface_microbial_count | CFU/cm2 |
| personal_dose_equivalent | uSv |
| personal_dose_equivalent_rate | uSv/h |
| co2 | ppm |
| cabin_pressure | kPa |
| cabin_temperature | degC |
| relative_humidity | percent |
| sound_level | dBA |
| illuminance | lux |

**Download device CSV** uses these same 27 columns. It exports supported valid measurements only, omitting faulty/suspect observations rather than presenting them as valid readings. Conflicting values at the same timestamp must be reconciled; multiple astronauts or missions must be exported separately. The full original source records and quality/provenance remain in the app's Log. The clean CSV is a measurement dataset, not an audit backup.

Fixed units are supplied internally when readings are normalized for dashboard evaluation. Point cabin readings can trigger a clearly labeled single-reading warning, but do not establish a sustained interval-average exposure. Simple dose readings remain visible but are excluded from dose totals until separate instrument verification and acquisition history exist. No timing, calibration or counter continuity is fabricated merely to fill a dashboard.

Advanced legacy files with explicit acquisition metadata remain readable for compatibility, including the full-workflow fixture. They are not primary templates. Self-reported mood, available sleep time, symptoms and crew actions remain separate manual inputs. Software rules and procedures stay in `device-config.js`. Synthetic imports create separate scenarios; observed imports preserve their mission identity, deduplicate, and use import time for freshness. Validation is atomic and preserves source row numbers. The parser can still handle audited corrections in advanced source records.

## Dashboard and action workflows

Attention cards show health concerns, a semicircular gauge for measurements with a configured demo reference, and **Open procedure**. Gauges label their scale, reference and absolute deviation. Single-limit rules show only the configured boundary; the reference band does not establish overall health. Historical interval episodes show their most extreme recorded interval value, not an average across the episode. Data-quality warnings, stale or missing logs, task reminders and handoff status remain in the system evidence and Log. Open procedure shows the cached checklist and action form immediately; evidence and previous actions are collapsed. Completed follow-ups remain in the Log.

**Open procedure** shows local demo steps immediately and automatically requests an AETHER suggestion through `POST /api/guidance`. The Node server forwards the selected concern to the loopback Python `POST /ask` endpoint. A confident, non-nominal match replaces the local steps with the returned crew-action checklist. Low-confidence matches, invalid responses, timeouts and offline operation retain the onboard checklist. The crew never needs to type a search.

The suggestion shows the model's demo alert flag. Medicine-kit references, model time-to-criticality estimates and hardware command suggestions are in collapsed **Model references**. These are unvalidated prototype outputs; hardware commands are displayed only. Saving an action preserves the displayed suggestion, model/corpus fingerprint, source IDs and retrieval time with the action. AETHER suggestions do not change the existing CSV alert rules.

The proxy reads `AETHER_API_KEY` from the Node process environment and sends it as a Bearer token; the browser never receives it. Set it before `npm start` if the Python service requires authentication. Only the selected observation or report is forwarded locally. Private support notes use a generic check-in request. The integration uses `/ask` to avoid `/triage` substituting nominal defaults for missing measurements. The actual triage field is `cabin_ppco2_mmhg`; CSV CO₂ remains in ppm and is never treated as mmHg by the reading-hint parser.

For the separate optional AETHER API on Windows, set up the Python environment using the first two commands. Then run `npm start` from the repository root. It starts the local AETHER service if needed. The scikit-learn version matches the saved classifier.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install scikit-learn==1.9.1 pillow jsonschema
npm start
```

The dashboard integrates warnings with body systems, inline anatomy circles, the attention queue and right-hand readings/trends. Use the system list when WebGL is unavailable. The separate **Log** page retains original observations, corrections, imported evidence and recorded actions.

- **Radiation:** non-overlapping compatible dose segments, continuous-counter differences, interval-average rate integration, spacewalk coverage and recorded mission total. Faults, unverified instrument status and overlaps do not count. The sample spacewalk gives 24 uSv over 120 minutes; removing RAD-GAP-FILL leaves 16 uSv and 80 minutes missing.
- **Isolation:** sleep compared with opportunity distinguishes schedule limitations from interruptions. Crew check-in requests work independently of mood. Actions and completion persist; restricted support notes and their follow-ups are scoped to the requesting profile and excluded from handoff exports.
- **Distance:** open a finding's **Review & record action** to read its cached versioned demo procedure, record an action/result and owner, assign a full UTC deadline or complete a task/case. **Prepare ground handoff** saves and downloads a snapshot of explicitly selected source records and the crew question. Delivery remains unconfirmed.
- **Gravity:** transition corrections recalculate elapsed time to linked symptom onset while retaining the assessment deadline and outcome. The sample correction changes 20 minutes after landing to 10 minutes.
- **Closed environment:** independent CO2, pressure and temperature interval rules, historical excursions matched by mission/compartment/time, sensor quality and stale-record warnings. Shared cabin episodes remain visible across crew profiles.

**Mission actions & scenario clock** controls the fictional evaluation time, overdue checks and freshness. Complete coverage means required evidence exists; it does not mean that the astronaut is healthy or that old records establish present conditions. The sample deliberately contains warnings to demonstrate review workflows.

## Storage and offline use

Records, actions and exported snapshots live in browser IndexedDB on this device. The service worker caches code, anatomy, fixtures and procedures. After **Offline cache ready**, the app can reload, edit and save with the local server stopped. Browser data clearing removes local records; there is no cloud database or ground delivery service. Provision the app before disconnecting. A separate tablet requires HTTPS or its own local server for initial setup.

## Anatomy and limits

Local Open Anatomy 3D male reference anatomy supports overlapping skin, muscles, bones, organs, vessels and nerves, with separate visibility/opacity and default reset. BodyParts3D © DBCLS, adapted by Open Anatomy 3D, CC BY 4.0. See `assets/anatomy-ATTRIBUTION.md`. The source nerve layer contains cranial nerves and a short spinal segment, not the full peripheral nervous system. Model-viewer and meshoptimizer run locally. WebGL is required for 3D.

Combined five-hazard CSV files are auto-detected by record_type. All 44 columns in data/fixtures/five-hazards-synthetic.csv are required. Preview shows every field. Import creates mission-scoped crew profiles and stores shared mission records once. IDs, same-mission references, UTC times, units, corrections and duplicate conflicts are validated before atomic save. Existing health CSVs remain supported. Compatible wellbeing and cardiovascular values feed existing trends and demo health rules. Other typed records, procedures, tasks and expected test outcomes are inspectable in Imported mission records in the Log and matching system panels. Radiation dose calculations, cabin exposure episodes, task execution and handoff transmission are separate pending workflows. expected_result rows are test descriptions, never measured results.

## UI refinement preview

The Mediva-inspired overview opens at `/` or `#home`, with direct links to `#dashboard`, `#profile`, and `#log`. The dashboard retains the existing check-ins, CSV import, evidence, reviews, and corrections. Frontend changes preserve form fields, input handlers, domain modules, IndexedDB storage, fixtures, and server behavior. The service-worker cache version is advanced to deliver the new interface. Use `npm start` for the local preview.

Integration baseline: `main` and `ui-refine` both pointed to `25662b4` when this redesign began. The teammate owns forthcoming CSV/manual input changes on `main`; integrate that update and repeat input workflow checks before claiming compatibility with it.

### Full-page reference layout and photography

The overview follows the Mediva full landing-page composition: utility/navigation, gradient hero with three visual panels, four service cards, two alternating photo/text features, four visual health cards, navigation beside a seven-panel gallery, oversized closing callout, and four-column dark footer. Copy and routes use Crew Health's shipped workflows. NASA photos are embedded as optimized JPEG data URLs in CSS so the existing server allowlist and offline file set stay unchanged. Move these to standalone static assets when server asset delivery can be changed.

The corner backdrop uses a locally cached Viking mosaic credited to NASA/JPL/USGS. [Global Color Views of Mars](https://science.nasa.gov/photojournal/global-color-views-of-mars/).

Photo credits: NASA — [Spinal Ultrasound investigation](https://www.nasa.gov/image-article/astronauts-perform-spinal-ultrasound-investigation/), [Jessica Watkins in the cupola](https://www.nasa.gov/image-article/view-of-earth-from-space-station/), and [Steve Swanson exercising on T2](https://www.nasa.gov/image-article/exercising-t2-treadmill/). Original media URLs:
- https://www.nasa.gov/wp-content/uploads/2023/03/iss036e035750.jpg
- https://www.nasa.gov/wp-content/uploads/2023/03/04_iss067e033423.jpg
- https://www.nasa.gov/wp-content/uploads/2023/03/iss040e086609.jpg

## Homepage motion

Lenis 1.3.27 is pinned in package.json/package-lock.json and vendored from its published ESM distribution into assets/lenis.js with its MIT license. The recommended Lenis stylesheet is included in style.css. No CDN or build step is used. The server change only registers the three new frontend assets in its static allowlist; data handling stays unchanged.

Only the homepage smooths fine-pointer wheel input (lerp 0.1, matching the portfolio reference); touch, reduced-motion users, keyboard navigation, application routes and dialogs retain native scrolling. Section reveals play once while the page remains open, using the portfolio’s 650ms/28px standard reveal and cubic-bezier(0.22, 1, 0.36, 1). Imagery uses its 1500ms sampled spring (stiffness 210, damping 13); grouped photos stagger by 150ms and service cards by 100ms. Headlines use 500ms word entrances staggered by 50ms, adapting the reference’s letter timing for longer health copy. Reduced motion gets a 180ms opacity fade without movement or delay. Keyboard navigation immediately finishes active reveals. Pointer focus leaves unrelated section reveals running. Pointer activation also settles residual scroll inertia; the next wheel gesture resumes smoothing. Navigating away disconnects observers and destroys Lenis.

After `npm ci`, vendor updates use `cp node_modules/lenis/dist/lenis.mjs assets/lenis.js` and `cp node_modules/lenis/LICENSE assets/lenis-LICENSE.txt`; copy the upstream stylesheet into the marked style.css section and advance the service-worker cache version.

### Glass materials

Floating navigation, hero photo overlays and dialogs use distinct translucent material weights, specular edges and restrained shadows. Health reading cards and input controls remain opaque. Browsers without backdrop-filter use solid fallback surfaces. Reduced-transparency and increased-contrast media queries remove blur and make materials solid where supported. Dialog entry uses a short scale/blur materialization; reduced motion retains an opacity-only entry. No extra animation library or backend changes were needed for this refinement.

### Portfolio animation reference

Motion timing and physics were verified against the live [Ted portfolio](https://ted0103.github.io/) JavaScript and CSS, rather than inferred from screenshots. Mediva’s section layout and the glass surfaces remain. The homepage adopts the entrance family and default Lenis wheel feel; scroll-driven project stacking, splash-screen waits, looping stickers, and pointer lenses are not part of this adaptation. Keyboard, touch and reduced-motion paths retain their previous safeguards.


### Workspace entrances

Dashboard, Profile & data and Log use 280ms/10px entrances with 40ms staggering capped at 120ms. Heading/panel entrances and the first six log entries orient the reader on route entry; the attention queue and review strip remain immediately visible. Saves, profile switches and body-system selection on the current route do not replay motion. Reduced motion uses a 180ms opacity-only entrance; keyboard navigation skips entrances. Pointer interaction or focus on a control settles in-flight workspace motion. Workspace scrolling remains native.
