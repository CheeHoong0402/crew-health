# Crew Health

Local health monitoring MVP based on the supplied challenge brief.

Run with Node.js using `npm start`, then open http://127.0.0.1:4173. Vendored browser assets are included. Use `npm ci` when updating development dependencies. Run checks with `npm test`.

## Two pages

**Dashboard** shows the anatomy diagram, system observations, warnings, follow-ups, seven-day trends and read-only observation history. The body system list provides keyboard access to the same regions.

**Astronaut profile & data** contains editable personal details, mission context, manual health check-ins, CSV import, symptom reports and audited corrections. Personal details include name, astronaut ID, mission name, crew role, date of birth, height, body mass and blood group. These optional details save with the selected profile.

Previously stored profiles and measurements continue to work. Profiles without personal information start with blank fields. Historical records remain in browser IndexedDB, including data saved by the earlier layout. The dashboard reflects the selected profile's entries immediately.

After the offline cache reports ready, both pages work without the local server. The anterior anatomy illustration was generated with ImageGen. The back view is a schematic locator. The app uses no external fonts, CDNs or runtime APIs. Research links require connectivity.

## CSV input

On Astronaut profile & data choose **Import CSV**, select a file, review the preview, then import. Files use comma-separated UTF-8 with quoted fields supported, at most 1 MB and 1000 data rows. Required columns are `mission_day,timestamp_utc,phase,data_kind`. Optional columns are `heart_rate_bpm,systolic_mmhg,diastolic_mmhg,temperature_c,sleep_hours,mood,glucose_mgdl,context`. Timestamps use UTC with seconds, such as `2026-11-14T08:10:00Z`. Mark rows `synthetic` or `observed`. Blank measurements remain unavailable. Zero hours of sleep is valid.

All CSV fixtures are stored in `data/testing/`. The included **healthy-data.csv** and **unhealthy-data.csv** each contain seven fictional days. Synthetic files default to a separate test profile with the fictional 7–8 h reference. The healthy example produces no sleep follow-up. The unhealthy example ends with 5.5 h and 5 h and produces the sleep review warning. Other measurements are available for manual trend review.

Imports append in one save after all rows pass validation. Re-importing identical records skips duplicates, including records later corrected. Changing CSV values creates additional observations. Use the correction workflow for an audited correction.

## Prototype limits

Use fictional demonstration records. Authentication, ground transmission, connected devices, verified clinical alert rules and mission emergency protocols require separate integration before real crew use. The simulated sleep rule supports demonstration and review.

The redesigned dashboard adds five hazard coverage cards linked to the existing system evidence, plus a clearer attention queue. New health CSV imports retain the source row and import timestamp alongside collection time. Event acknowledgments retain action notes when the case stays open. Dosimetry, habitat, gravity-transition schemas and offline procedure workflows remain planned in AGENTS.md.

The anatomy panel uses a local 3D skeleton with rotation, zoom, front/back reset and skeletal markers. Source https://www.innerscene.com/tools/library/3d-parts/full-adult-skeleton-standing-ade55011 (Innerscene, CC0). Google model-viewer 4.1.0 is Apache-2.0 licensed, see assets/model-viewer-LICENSE.txt. The viewer and GLB are cached offline. WebGL is required. Preserve the body-system list for access if rendering fails. This general skeleton is a reference, not a patient scan.

The anatomy panel now uses the male Open Anatomy 3D model with selectable bones, skin, muscles and nerves. BodyParts3D © DBCLS, adapted by Open Anatomy 3D, CC BY 4.0. Local changes add colored layer materials and visibility. See assets/anatomy-ATTRIBUTION.md and anatomy-LICENSE.md for full upstream credits. A local meshoptimizer 0.22 decoder (MIT) supports offline loading. The reference anatomy is educational and does not represent patient findings.

The source nerve layer contains cranial nerves and a short spinal-cord segment. Its view zooms toward the head and labels this limited coverage. Peripheral nerve anatomy is absent from this model.

Dashboard monitoring now evaluates the latest available reading of every supported health indicator using visible fictional demo rules v1. Findings appear in the queue, matching body region, and system evidence after CSV import, manual save, correction and reload. Review actions retain the source finding, and acknowledgments leave abnormal readings visible. New evidence recalculates the latest-reading findings. The five hazards are integrated as system context and missing-evidence requirements. Personal dosimetry, cabin data, transition exams and ground delivery remain pending. These rules require mission validation for crew use.

Interface cleanup consolidates sleep findings, keeps source metadata expandable, and limits dashboard activity to five entries. Full history and corrections remain on the data page. Optional medical details and test datasets are collapsible. Select an alert to locate its body system, then use its review action to record a response or schedule a sleep follow-up.

The Log button opens #log, a dedicated full history page for the selected astronaut. Original observations, corrections, events and reading reviews appear there with UTC times. Corrections open from the log. The dashboard and profile page link to this log.

Combined five-hazard CSV files are auto-detected by record_type. All 44 columns in data/testing/five-hazards-synthetic.csv are required. Preview shows every field. Import creates mission-scoped crew profiles and stores shared mission records once. IDs, same-mission references, UTC times, units, corrections and duplicate conflicts are validated before atomic save. Existing health CSVs remain supported. Compatible wellbeing and cardiovascular values feed existing trends and demo health rules. Other typed records, procedures, tasks and expected test outcomes are inspectable in Imported mission records in the Log and matching system panels. Radiation dose calculations, cabin exposure episodes, task execution and handoff transmission are separate pending workflows. expected_result rows are test descriptions, never measured results.

## UI refinement preview

The Mediva-inspired overview opens at `/` or `#home`, with direct links to `#dashboard`, `#profile`, and `#log`. The dashboard retains the existing check-ins, CSV import, evidence, reviews, and corrections. Frontend changes preserve form fields, input handlers, domain modules, IndexedDB storage, fixtures, and server behavior. The service-worker cache version is advanced to deliver the new interface. Use `npm start` for the local preview.

Integration baseline: `main` and `ui-refine` both pointed to `25662b4` when this redesign began. The teammate owns forthcoming CSV/manual input changes on `main`; integrate that update and repeat input workflow checks before claiming compatibility with it.

### Full-page reference layout and photography

The overview follows the Mediva full landing-page composition: utility/navigation, gradient hero with three visual panels, four service cards, two alternating photo/text features, four visual health cards, navigation beside a seven-panel gallery, oversized closing callout, and four-column dark footer. Copy and routes use Crew Health's shipped workflows. NASA photos are embedded as optimized JPEG data URLs in CSS so the existing server allowlist and offline file set stay unchanged. Move these to standalone static assets when server asset delivery can be changed.

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
