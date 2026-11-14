# Crew Health · Repository guide and implementation plan

## Product and scope

Build an offline-first tablet app for reviewing astronaut health and habitat data **from CSV files** across five NASA spaceflight hazards. An astronaut imports a file, sees what the records show, opens applicable guidance, and records the action taken. A reviewer can trace each finding back to its source rows, rule, and any corrections.

The detection time is the time of import and evaluation. If a cabin event occurred at 10:10 UTC and the crew imports its log at 14:00 UTC, display both times. Use fictional records, labeled demo thresholds, and versioned demo procedures for this release. Operational thresholds, instructions, devices, and access controls require mission validation.

**Current baseline.** The app ships a dashboard, profile/data page and dedicated Log page. Preserve old profiles, manual health check-ins and health CSVs. The primary external-device input uses one row per UTC timestamp with a fixed unit per measurement column; synthetic imports create separate scenarios and observed imports preserve their mission identity. The 44-column full-workflow fixture remains a compatibility format. All five hazard evaluations and local action workflows run on-device. Real device ingestion, clinical protocols, access control and ground transport remain outside scope. See README.md for the shipped behavior and verification limits.

## Stack and framework decisions

| Area | Choice for this release | Responsibility |
|---|---|---|
| Application | Browser-native Progressive Web App (PWA), HTML, CSS, JavaScript ES modules | Render dashboard, profile/import screen, accessible body-system list, and guidance dialogs. Keep the existing framework-free frontend. |
| Domain logic | Plain JavaScript functions | Validate records, reconcile intervals, evaluate versioned rules, and produce findings independently of the DOM. Unit-check incoming CSV values at runtime. |
| Persistence | IndexedDB | Store personal and mission-scoped records, provenance, corrections, alerts, and crew actions. Use atomic commits and handle conflicting tabs. |
| Offline assets | Service Worker, Cache API, web app manifest | Preload the interface, fixtures, and demo procedures. Cache assets separately from health records. |
| Development and delivery | Node.js built-in HTTP server; static assets | Run locally with `npm start`. The existing server listens at `http://127.0.0.1:4173`. For a separate tablet, provision the app over HTTPS or via a local server on that device before disconnecting. |
| Verification | Node built-in test runner and browser acceptance tests | Run `npm test` from the repository root. On Windows, `npm.cmd test` works in PowerShell. Exercise offline restart on the intended tablet. |

React, FastAPI, a TypeScript migration, live sensor ingestion, and cloud inference are outside this CSV release. The chosen stack already reads local files and runs comparisons on-device. Keep the proposed ML guide optional and independent of abnormal-reading detection.

## Architecture and ownership

    CSV on device → select type and destination → parse and validate → preview
        → confirm → reconcile with existing records → evaluate affected rules
        → commit observations, provenance, and alert changes in one transaction
        → dashboard → evidence and cached guidance → crew action and follow-up

| Project area | Implementation responsibility |
|---|---|
| `csv.js`, `csv.test.js` | Reuse CSV decoding and file limits. Add schema-specific validators, row-level errors, import previews, and duplicate/conflict handling. |
| `model.js`, `model.test.js` | Own record semantics, units, UTC intervals, current revisions, calculations, rule versions, follow-up state, and expected results. |
| `app.js`, `index.html`, `style.css` | Bind the import preview, explicit save, attention queue, body map, timelines, and action dialogs. Use the same domain logic on import, correction, and reload. |
| `server.js`, `sw.js`, `manifest.webmanifest` | Serve and cache required local assets. Update the server allowlist and service-worker cache version together when adding offline procedures or modules. |
| `README.md` and sample CSVs | Document shipped schemas, startup, examples, offline setup, and known limits as each milestone lands. Keep existing examples usable. |

Keep astronaut observations profile-scoped. Store habitat readings once per mission and compartment, using a stable mission ID shared by its crew. Link events, observations, assessments, and tasks by stable IDs. Preserve the original value, unit, event time, import time, file name, row number, source identifier when supplied, and correction history. Keep support notes out of shared task titles. Export only fields selected for a handoff.

## CSV contracts and import behavior

The health contract and combined 44-column mission contract are implemented. The table below records the intended semantics; use hazard-csv.js and the complete sample for the actual shipped headers. Publish a downloadable header and a small synthetic example for each implemented type. Detect the type from headers and show the destination in preview. Complete demo files create separate synthetic mission namespaces. New contracts should include `data_kind` and identify the mission and astronaut or compartment through validated columns or an explicit import selection.

| File type | Fields and interpretation |
|---|---|
| Health and wellbeing | Preserve required `mission_day,timestamp_utc,phase,data_kind` and optional `heart_rate_bpm,systolic_mmhg,diastolic_mmhg,temperature_c,sleep_hours,mood,glucose_mgdl,context`. Add optional `sleep_opportunity_hours,posture,activity`. Both sleep durations cover the preceding 24 hours. |
| Mission events | Use `event_id,event_type,timestamp_utc` for spacewalk start/end, gravity transition, or symptom report. Pair spacewalk boundaries with a shared activity ID. Include from/to environments for transitions and onset, report time, and location when known for symptoms. |
| Personal dosimetry | Require device ID, astronaut assignment, dose quantity, value, unit, and reading type. Interval dose and interval-average rate need start and end times. Cumulative counters need a timestamp and a known counter session. Retain reset, fault, clock, and calibration status. |
| Habitat | Require compartment, sensor ID, quantity, value, unit, and sample time or interval. Include sampling interval, quality, and whether the value is a point sample or interval average. Start with CO₂ and extend to cabin pressure and temperature. |
| Assessments and exercise | Include astronaut, record type, body system, observation time, source, result, and applicable unit or method. Link to the scheduled assessment, symptom, or transition when known. Keep exercise completion distinguishable from a measured exam result. |

1. Accept UTF-8 CSV with quoted fields, escaped quotes, BOM, and CRLF. Preserve existing limits of 1 MiB and 1,000 data rows per file. For larger histories, support successive overlapping file imports. Use UTC timestamps with seconds, such as `2026-11-14T10:18:00Z`. Preserve valid zeros and leave unknowns blank.
2. Validate required headers, field counts, identifiers, time order, units, and type-specific constraints before writing. Reject a structurally invalid batch with the row and reason. Preview valid but suspect readings with their quality flags and explain any exclusion from calculations.
3. Preview destination, data kind, time span, accepted rows, duplicates, conflicts, and warnings. Keep synthetic examples identifiable. Preserve the existing identities of legacy health records so an older CSV still deduplicates after an upgrade.
4. Deduplicate by stable source record ID or canonical measurement identity within scope. A renamed file stays a duplicate. For instrument records, the same device, quantity, and interval with conflicting values requires review. Preserve originals and correction reasons. Re-import must never resurrect a superseded record.
5. After confirmation, evaluate the affected astronaut or mission timeline, including earlier rows supplied out of order. Save accepted records and derived alert changes consistently. On failed save or concurrent edit, report the failure and retain a recoverable preview. Keep private text and CSV cells escaped when rendered.

## Abnormal data and astronaut guidance

Each rule specifies its version, quantity, unit, applicable population or instrument, threshold or trigger, comparison operator, window, coverage and freshness requirements, and linked procedure. Include the source readings behind the result. Each action card shows the observation, UTC interval, detection/import time, why it appeared, owner, and next step.

Create one alert per episode. New readings update its evidence; a gap can coexist with an earlier confirmed crossing. Acknowledgment records who reviewed the item and when. Track resolution and task completion separately. A correction must recalculate the finding while retaining prior actions in history. If the data are stale, faulty, missing, or lack an applicable rule, say which condition applies. An imported file cannot establish the current state of the cabin beyond its coverage.

Use reviewed local checklists for execution. Open the applicable procedure or form, let the astronaut confirm an action, and persist the outcome. For an optional later workflow search, evaluate a small offline text classifier against a searchable menu. Ambiguous requests such as “pressure” should offer cabin pressure and blood pressure. Keep urgent alerts visible independently of search results. See [Offline ML Guidance Plan](./Offline%20ML%20Guidance%20Plan.md).

## Implementation plan by hazard

### 1. Space radiation

1. Import the astronaut’s spacewalk interval and personal dosimeter records. Show assignment, instrument status, quantity, unit, and time coverage.
2. Sum compatible, non-overlapping interval doses. Difference cumulative readings only within a verified continuous counter session. Integrate an average rate only over its documented interval. Resolve overlaps between devices or representations before counting. Calculate mission totals from accepted source readings.
3. Evaluate dose and dose-rate rules separately. Present the measured value and procedure for a crossing. Show uncovered intervals and ask the crew to verify the log. Never infer personal dose from pulse or cabin conditions.
4. **Acceptance:** for a 12:00–14:00 walk, continuous counter values of 100, 112, and 116 µSv at 12:00, 12:30, and 12:40 yield **16 µSv recorded and 80 minutes missing**. Importing the file twice gives the same result. An additional valid 8 µSv covering the gap produces 24 µSv over 120 minutes.

### 2. Isolation and confinement

1. Import actual sleep, available sleep time, optional self-reported mood, and shift context. Let the astronaut request a crew check-in directly, including on days with no readings.
2. Extend the existing consecutive-day sleep review. Five hours slept in five available prompts schedule review. Five hours in eight available prompts a question about interruptions. Use the configured fictional reference and show the days that triggered it.
3. Track the support request, intended recipient, acknowledgment, and outcome independently of sleep corrections. Add an operational shift handoff for unfinished work, next owner, and due time. Keep mood interpretation descriptive.
4. **Acceptance:** the supplied short-sleep scenario prompts review. A missing day breaks the sequence. A request with typical mood or blank measurements still creates one follow-up that survives restart.

### 3. Distance from Earth

1. Link imported observations to a local case. Record onset, readings and units, actions, responses, responsible crewmate, and the next check’s full UTC deadline. Fix the existing path that drops action text when an event is acknowledged and kept open.
2. Package a versioned demo procedure locally. Put it and the next assigned action within reach from both the case and dashboard while disconnected.
3. Prepare a dated snapshot for the flight surgeon, including the crew’s question. Support local export and distinguish saved, exported, and any explicitly simulated receipt or reply. Keep crew work visible while the handoff awaits acknowledgment.
4. **Acceptance:** disconnect after setup, recover a fictional 14:12 incident, open its procedure, save an action, and assign the 14:30 check. Restart offline and recover all four. Export leaves delivery unconfirmed.

### 4. Changing gravity

1. Import dated gravity transitions and symptoms. Retain phase, prior/new environment, onset and report times, posture, and activity. Display unknown gravity when the source supplies only a generic mission phase.
2. Link the transition and symptom to an assessment with owner, UTC deadline, status, and actual result. Compare pulse and pressure under identified conditions. Route both anatomy controls and the accessible list to the same evidence.
3. Show balance reports and exams under head and balance, vision reports and eye exams under eyes, exercise and measured strength under limbs, and the latest actual bone-density exam under spine and bones.
4. **Acceptance:** landing at 09:00, dizziness onset at 09:20, and entry at 09:35 show **20 minutes after landing**. Correcting landing to 09:10 yields 10 minutes. The 09:45 assessment stays scheduled; missing exams stay visible.

### 5. Hostile and closed environments

1. Deliver the cabin CO₂ import first. Display compartment, last valid value and unit, time, source, age, and log. Apply the configured averaging window and freshness rule. Extend to pressure and temperature with independent rules.
2. Match symptom onset to cabin records by **mission, compartment, and time**. Keep crew-wide warnings visible across astronaut profiles even with no symptom report. Keep personal symptoms visible if cabin coverage is missing.
3. Give each excursion an evidence view and a link to its onboard procedure. Break coverage across missing samples and distinguish point observations from confirmed interval averages.
4. **Acceptance:** an above-limit interval from 10:10 to 10:24 in sleeping quarters overlaps a headache there at 10:18. A report elsewhere stays separate. Import at 14:00 shows a historical crossing. Duplicate input, stale values, and a second astronaut must not manufacture an additional episode.

## Delivery order and release checks

| Milestone | Deliverable | Completion check |
|---|---|---|
| 1. Foundation and Hazard 3 | Source-aware import, UTC tasks, corrected event updates, offline case and procedure | The 14:30 case survives restart on the target tablet. Legacy profiles and health files still open. |
| 2. Hazard 1 | Dosimeter schema, calculator, rule evidence, coverage gaps | Pass the spacewalk arithmetic, reset, overlapping interval, and repeated-import cases. |
| 3. Hazard 2 | Sleep opportunity, independent support request, shift handoff | Verify missing data, corrections, acknowledgment, and closure independently. |
| 4. Hazard 4 | Transition timeline, contextual observations, linked assessments | Reproduce the landing scenario and open actual source records from both anatomy selectors. |
| 5. Hazard 5 | Shared cabin data, CO₂ alert and checklist, then pressure and temperature | Reproduce the historical crossing, gap, and two-profile cases. |
| 6. Integrated demo | All five import workflows, evidence, guidance, updated README and fixtures | Complete each workflow disconnected with the local server stopped after initial setup. |

Run `npm test` at baseline and after each milestone. Add hand-checked fictional fixtures for every new schema. Exercise threshold equality, delayed and out-of-order import, file rejection without partial writes, interrupted saves, competing tabs, old profiles, and correction plus re-import. Check keyboard navigation, textual warning labels, and that exported handoffs contain only selected fields.

On the target tablet, rehearse first-load provisioning and a cold offline restart. Import the intended mission volume in successive files, then time a simple check-in. The current save path clones the profile collection. If sensor histories materially slow routine saves, move instrument records into dedicated indexed stores and migrate existing data transactionally. Test storage-full behavior and recovery before claiming reliable retention.

For more detail use the [Five Hazards Implementation Plan](./Five%20Hazards%20Implementation%20Plan.md) and [MVP dashboard plan](./MVP%20Plan.md). Maintain this repository guide when a shipped schema, architecture choice, or milestone changes.

## Shipped integrated demo

`mission-demo.js` owns current source revisions, 17-area coverage, dose reconciliation, sleep opportunity, gravity timing, cabin episodes/freshness, tasks/actions and selective handoff. Data entry groups ordinary record types rather than the five hazards; hazard evaluation remains in the dashboard logic. `demo-editor.js` edits every field of the complete artificial fixture without a new dependency. Both manual and combined CSV paths serialize, validate, stage and commit using the same parser/importer. The 142-row example fills seven-day routine trends and all 12 system panels for A-07. A-08 remains a deliberate partial profile for shared cabin verification.

The dashboard uses overlapping local Open Anatomy 3D layers with colored circles and inline callouts. Preserve the keyboard-accessible system list. BodyParts3D © DBCLS, adapted by Open Anatomy 3D, CC BY 4.0; see assets/anatomy-ATTRIBUTION.md. The model is an educational reference with limited nerve coverage, not a patient scan.

Mission records are stored once in `state._missions`; health projections and personal symptoms reuse existing profile paths. Actions remain distinct from resolution; completing a case hides its duplicate imported event. Private support follow-ups stay profile-scoped and out of exported handoffs. Browser profile scoping is not authentication.

The service worker caches both new modules and the complete fixture; update its cache version after changes. Node checks cover the five hazard acceptance scenarios. Browser verification has exercised manual edits/save, action persistence, selective local download, server-stopped restart and action save, and mobile data-entry overflow. Chrome extension policy blocks automated file selection, so actual upload picker completion and physical target-tablet, storage-full and production-scale checks remain unverified. Do not describe the demo as clinically validated or ground-connected.


## External-device observation contract

The primary `data/testing/astronaut-health-data.csv` and standard `deviceCsv` download have exactly 27 columns: record_id, timestamp and the 25 measurements in deviceUnits. Values belong under measurement columns. Units are fixed in code and never repeated in the file. Astronaut, mission, day, synthetic/observed mode and compartment come from import context. The default mode is synthetic. The sample has 19 unique timestamps and 92 populated measurements. Both former user-facing sample filenames contain the same clean format. Detailed source fixtures are explicitly marked source-fixture or legacy for compatibility tests.

`device-csv.js` normalizes populated cells into source records with fixed units and preserves CSV row provenance. Its metadata-rich export is internal/advanced compatibility support; product downloads use the default clean export. Valid measurements only enter the clean export; source faults remain in original logs. Never fabricate calibration, counter continuity, spacewalks or incidents to make simple readings look complete. Point cabin values produce point-reading warnings, separately from confirmed interval-average excursions. Unverified dose observations remain excluded from calculated totals. `device-config.js` supplies fictional software rules and guidance independently of the CSV. Existing stored records and older input contracts remain supported. Cache/serve the primary template offline and update the service-worker version with changes.
