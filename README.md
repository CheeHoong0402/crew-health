# Crew Health

Local health monitoring MVP based on the supplied challenge brief.

Run with Node.js using `npm start`, then open http://127.0.0.1:4173. No dependency installation is needed. Run checks with `npm test`.

## Two pages

**Dashboard** shows the anatomy diagram, system observations, warnings, follow-ups, seven-day trends and read-only observation history. The body system list provides keyboard access to the same regions.

**Astronaut profile & data** contains editable personal details, mission context, manual health check-ins, CSV import, symptom reports and audited corrections. Personal details include name, astronaut ID, mission name, crew role, date of birth, height, body mass and blood group. These optional details save with the selected profile.

Previously stored profiles and measurements continue to work. Profiles without personal information start with blank fields. Historical records remain in browser IndexedDB, including data saved by the earlier layout. The dashboard reflects the selected profile's entries immediately.

After the offline cache reports ready, both pages work without the local server. The anterior anatomy illustration was generated with ImageGen. The back view is a schematic locator. The app uses no external fonts, CDNs or runtime APIs. Research links require connectivity.

## CSV input

On Astronaut profile & data choose **Import CSV**, select a file, review the preview, then import. Files use comma-separated UTF-8 with quoted fields supported, at most 1 MB and 1000 data rows. Required columns are `mission_day,timestamp_utc,phase,data_kind`. Optional columns are `heart_rate_bpm,systolic_mmhg,diastolic_mmhg,temperature_c,sleep_hours,mood,glucose_mgdl,context`. Timestamps use UTC with seconds, such as `2026-11-14T08:10:00Z`. Mark rows `synthetic` or `observed`. Blank measurements remain unavailable. Zero hours of sleep is valid.

The included **healthy-data.csv** and **unhealthy-data.csv** each contain seven fictional days. Synthetic files default to a separate test profile with the fictional 7–8 h reference. The healthy example produces no sleep follow-up. The unhealthy example ends with 5.5 h and 5 h and produces the sleep review warning. Other measurements are available for manual trend review.

Imports append in one save after all rows pass validation. Re-importing identical records skips duplicates, including records later corrected. Changing CSV values creates additional observations. Use the correction workflow for an audited correction.

## Prototype limits

Use fictional demonstration records. Authentication, ground transmission, connected devices, verified clinical alert rules and mission emergency protocols require separate integration before real crew use. The simulated sleep rule supports demonstration and review.

The redesigned dashboard adds five hazard coverage cards linked to the existing system evidence, plus a clearer attention queue. New health CSV imports retain the source row and import timestamp alongside collection time. Event acknowledgments retain action notes when the case stays open. Dosimetry, habitat, gravity-transition schemas and offline procedure workflows remain planned in AGENTS.md.

The anatomy panel uses a local 3D skeleton with rotation, zoom, front/back reset and skeletal markers. Source https://www.innerscene.com/tools/library/3d-parts/full-adult-skeleton-standing-ade55011 (Innerscene, CC0). Google model-viewer 4.1.0 is Apache-2.0 licensed, see assets/model-viewer-LICENSE.txt. The viewer and GLB are cached offline. WebGL is required. Preserve the body-system list for access if rendering fails. This general skeleton is a reference, not a patient scan.

The anatomy panel now uses the male Open Anatomy 3D model with selectable bones, skin, muscles and nerves. BodyParts3D © DBCLS, adapted by Open Anatomy 3D, CC BY 4.0. Local changes add colored layer materials and visibility. See assets/anatomy-ATTRIBUTION.md and anatomy-LICENSE.md for full upstream credits. A local meshoptimizer 0.22 decoder (MIT) supports offline loading. The reference anatomy is educational and does not represent patient findings.

The source nerve layer contains cranial nerves and a short spinal-cord segment. Its view zooms toward the head and labels this limited coverage. Peripheral nerve anatomy is absent from this model.

Dashboard monitoring now evaluates the latest available reading of every supported health indicator using visible fictional demo rules v1. Findings appear in the queue, matching body region, and system evidence after CSV import, manual save, correction and reload. Review actions retain the source finding, and acknowledgments leave abnormal readings visible. New evidence recalculates the latest-reading findings. The five hazards are integrated as system context and missing-evidence requirements. Personal dosimetry, cabin data, transition exams and ground delivery remain pending. These rules require mission validation for crew use.
