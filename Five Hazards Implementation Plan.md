# Astra Health implementation plan for NASA’s five spaceflight hazards

## Build order and scope

Deliver a single-device, offline-capable demonstration using fictional records. An astronaut should be able to see the observation, its time and source, and the next action. A reviewer should be able to open the underlying readings and reproduce a finding. The five hazard categories follow NASA’s Human Research Program. The scenarios and thresholds in this plan are for demonstration. [NASA’s five hazards](https://www.nasa.gov/hrp/hazards/)

| Build in this order | Deliverable | Demonstration that unlocks the next stage |
|---|---|---|
| 1. Shared foundation and Hazard 3 | Offline case, procedure, assignment, and handoff | Close and reopen the app without a connection. Recover the case and its next action. |
| 2. Hazard 1 | Personal dose, coverage, and exposure alerts | Reproduce one spacewalk total by hand and identify its missing interval. |
| 3. Hazard 2 | Rest review, voluntary support request, and shift handoff | Request support with no measurements and recover the request offline. |
| 4. Hazard 4 | Gravity transitions and linked assessments | Open a post-landing symptom and trace it to its assessment. |
| 5. Hazard 5 | Shared cabin monitoring | Demonstrate cabin CO₂ first. Complete the habitat view with pressure and temperature. |
| 6. Integrated acceptance | All five workflows on one tablet | Repeat the scenarios offline, with a second profile and corrected or missing data. |

Hazard 3 comes first because its UTC follow-ups, local procedures, and case history serve the other four. The hazard numbers below retain their NASA order.

## Shared foundation

1. **Preserve existing data.** Extend the current profile records, events, and follow-ups with optional fields. Load existing profiles and CSVs before and after the change. Retain IDs, correction links, original units, timestamps, and the distinction between zero and missing. Use a stable mission identifier for shared cabin records so each astronaut sees the same cabin event once.
2. **Make actions traceable.** Link each follow-up to its triggering record, owner, due time, and outcome. Store full UTC dates and times for timed work and preserve mission-day deadlines for existing tasks. Distinguish when an observation occurred, when it was entered, and when someone acknowledged it. Keep open work visible across days.
3. **Keep imports repeatable.** Reuse CSV decoding, size and row limits, preview, validation, and single-transaction saving. Use separate column definitions for health, dosimeter, and habitat files. Retain the source row or its original fields. Identify repeated readings independently of filename. Preview malformed rows, conflicting measurements, and duplicates with their consequences before the user saves.
4. **Put actions on the dashboard.** Keep urgent events and due or overdue actions above the anatomy diagram. Label thresholds exceeded, missing data, stale readings, and follow-ups in words. Open the evidence from each warning. A confirmed problem can coexist with missing data. Keep crew-wide warnings visible when switching between astronauts in the same mission.
5. **Work offline after setup.** Preload the app, procedures, and demo assets before disconnecting. Save changes through the existing IndexedDB transaction and revision checks. Confirm success only after a committed write. Keep a failed edit available for recovery. Retain the last usable cached app until an update installs successfully.

## Hazard 1 · Space radiation

**Outcome:** the crew can answer “How much personal exposure was recorded, over what interval, and does it require action?” [NASA personal radiation monitoring and alert requirements, §§6.8.1.4–6.8.1.6](https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2/)

1. Record each spacewalk’s astronaut, mission, and actual start and end in UTC. Allow the end time to remain open during the walk. Register the personal dosimeter’s ID, assignment period, measured quantity, supported unit, and calibration reference and validity.
2. Offer manual entry and dosimeter CSV import. Capture interval doses, cumulative counters, or dose rates with their applicable timestamps, units, status, and reset flags. Flag a device fault, uncertain clock, expired calibration, or assignment mismatch for review. Preserve the original evidence and identify which readings the calculation accepted.
3. Calculate dose and coverage per astronaut. Sum compatible non-overlapping interval doses. Difference successive cumulative readings only within one confirmed uninterrupted counter. Convert rates to dose only for a documented average over a known duration. Resolve duplicates, overlapping representations, and resets before counting. For intervals crossing a spacewalk boundary, show that the dose cannot yet be apportioned. Compute mission totals from accepted source readings so a spacewalk subtotal cannot be counted twice.
4. Compare validated readings with a versioned rule for the same quantity, unit, and time window. Store the comparison operator and procedure reference. Show the reading and procedure when the threshold is crossed. Label uncovered periods independently. Keep an accumulated dose and a peak-rate assessment separate.
5. **Acceptance:** simulate a 12:00–14:00 walk. A continuously operating counter reads 100 µSv at 12:00, 112 at 12:30, and 116 at 12:40. Expect **16 µSv recorded, 40 minutes covered, 80 minutes missing**. Re-importing the file adds zero. A verified 8 µSv interval covering the last 80 minutes produces **24 µSv over 120 minutes**. Test a reset, overlapping devices, and a threshold crossing before a gap.

## Hazard 2 · Isolation and confinement

**Outcome:** the astronaut can review rest, describe how they feel, and request human support independently of a score. Self-report and explicit rules are sufficient for the prototype. [NASA isolation and confinement overview](https://www.nasa.gov/hrp/hazard-isolation-and-confinement/)

1. Extend daily check-in with hours available for sleep during the same preceding 24 hours as recorded sleep, including opportunities for naps. Reuse overall mood and add optional current feelings and difficulty staying alert. Keep unanswered items blank. Add an optional sleep-opportunity column to health CSVs.
2. Reuse the existing two-consecutive-day sleep rule. Display the values and the fictional personal reference. Five hours asleep in five available suggests reviewing the duty schedule. Five hours asleep in eight available prompts the astronaut to record any interruption. Summarize repeated self-reported feelings using counts and dates. A missing day remains visible.
3. Place **Request a crew check-in** on the dashboard independently of the health form. Let the astronaut choose the intended recipient and submit without an explanation. Store it as a separate follow-up, prevent duplicate submissions, show local save and acknowledgment times, and close with a recorded outcome. A correction to sleep or mood leaves the requested conversation open.
4. Reuse the assignment workflow for shift handoffs. Record unfinished work, its incoming owner, and due time. Keep personal narratives out of shared task titles. In the demo use fictional information. Before real collection, enforce recipient access and allow the astronaut to choose the fields released in a handoff.
5. **Acceptance:** use the existing 5.5 h and 5.0 h example against its fictional 7–8 h reference. Correct one reading and verify that the warning updates. Submit a support request with mood marked Good and again in a separate scenario with all fields skipped. In each scenario one request survives an offline reload. Acknowledging an unfinished shift task keeps it open.

## Hazard 3 · Distance from Earth

**Outcome:** the crew can manage a case locally through a communications outage or a delayed reply. [NASA distance from Earth overview](https://www.nasa.gov/hrp/hazard-distance-from-earth/)

1. Extend the existing event screen with a timestamped sequence of observations, actions, and responses. Retain symptom onset if known, report time, source, readings, and units. Fix the current acknowledgment path so an action entered while the case stays open is saved. Keep urgent crew help reachable even without a sensor reading.
2. Bundle a clearly labeled, versioned demo procedure with the app. Open it from the urgent-help and case screens. Show its availability offline. Add any separate asset to both the local server allowlist and the service-worker cache.
3. Link a named owner and UTC deadline to the next check. Display it on the dashboard independently of acknowledgment or ground status. If the case is closed with work outstanding, keep that work visible until completed, reassigned, or explicitly deferred.
4. Generate a reviewable ground handoff from the case. Include onset, readings and units, actions, response, next check, and the question for the flight surgeon. Export only selected fields. Save a dated snapshot linked to the case so subsequent observations cannot overwrite what was prepared.
5. Show **Saved onboard** and **Exported** as local events. In a labeled simulation, or later through a communications service, distinguish dispatch, receipt, and reply with timestamps and the handoff ID. Reconnecting alone cannot confirm delivery. Retrying the same handoff should preserve one transmission identity.
6. **Acceptance:** disconnect after setup, open the fictional 14:12 incident, use its procedure, and assign a 14:30 UTC check. Close and restart the app. Verify the case, action, procedure, and handoff are available. Export the handoff and confirm delivery remains unconfirmed. Simulate a delayed reply while the crew adds an update and verify both remain on the correct case.

## Hazard 4 · Changing gravity

**Outcome:** the reviewer can reconstruct when a symptom began relative to a gravity transition and find the next assessment or last actual exam. [NASA gravity fields overview](https://www.nasa.gov/hrp/hazard-gravity-fields/)

1. Record transitions as dated events with astronaut, previous and new gravity environment, actual UTC time, and source. Preserve mission phase separately. Keep historical gravity unknown when only a generic phase such as Surface is available.
2. Extend symptom entry with onset, report time, posture, and activity. Link relevant readings and the transition by time. Add structured posture and activity to manual and CSV cardiovascular readings so seated, standing, and post-exercise observations can be identified. Retain historical free text.
3. Link existing scheduled assessments to the event or offer to assign one. Show owner, due time, and pending, completed, or deferred status. On completion, capture assessment time, method, source, result, and unit where applicable. Mark a crew-requested urgent report independently of the schedule.
4. Route the anatomy diagram and keyboard-accessible list to the same records. Head & balance shows dizziness reports and assessments. Eyes & vision shows reported changes and dated exams. Muscles & limbs shows exercise completion and measured strength. Spine & bones shows the latest actual bone-density result, or **No exam recorded**.
5. **Acceptance:** land at 09:00, record symptom onset at 09:20 and entry at 09:35. Expect **20 minutes after landing** with the demo assessment due at 09:45. Correct landing to 09:10 and expect **10 minutes**, with the assignment unchanged. Test pre-landing and unknown onset. Completing exercise must leave a missing bone exam visible.

## Hazard 5 · Hostile and closed environments

**Outcome:** the crew can see which measured cabin condition needs attention, where it occurred, and whether a symptom was reported in the same location and interval. [NASA hostile and closed environments overview](https://www.nasa.gov/hrp/hazard-hostile-closed-environments/)

1. **Start with Cabin CO₂.** Use that label for a single cabin. If several compartments are monitored, use their actual names, such as Sleeping quarters. Store habitat measurements once per mission and location. Keep personal symptom reports under the astronaut’s profile.
2. Add a habitat CSV import with location, sensor ID, measured quantity, value, unit, UTC timestamp or interval, sampling interval, and quality status. Preserve the reporting basis, such as a spot reading or interval average. Validate sensor, unit, and timestamp before rule evaluation. Reject impossible formats and flag conflicting or unreliable data for review.
3. Show the last valid value, unit, location, measurement time, age, status, and a link to the raw cabin log. Configure a demo rule with its quantity, unit, averaging period, threshold, and freshness policy. Mark an overdue sample **No recent reading**. Break coverage at missing intervals. Individual samples support a continuous excursion only to the extent justified by their sampling and averaging definitions.
4. Record the astronaut’s location and symptom onset. Show an environmental warning even when nobody reports symptoms. When place and time overlap, link the cabin evidence to the symptom. If the cabin log is absent, keep the symptom visible and identify the missing interval. Put shared warnings above the body diagram.
5. Add **cabin pressure** and **cabin temperature** using the same import and display path, each with its own units, rule, and freshness policy. A CO₂ reading supplies no evidence about these two quantities. Other streams such as noise, light, or laboratory sample results can use the location timeline when available.
6. **Acceptance:** import valid demo intervals above the CO₂ limit in Sleeping quarters from 10:10 to 10:24 UTC. A headache with onset there at 10:18 links to the excursion. A report at 10:18 in another compartment stays separate. Repeat with no headache, a missing interval, a stale last value, and a duplicate file. Switch astronauts in the same mission and verify the shared cabin warning remains visible.

## Files and verification

| Existing project area | Implementation work |
|---|---|
| `model.js`, `model.test.js` | Backward-compatible state, time and coverage calculations, rule evaluation, linked task and case behavior. Use deterministic tests with fixed UTC times. |
| `csv.js`, `csv.test.js` | Preserve current health imports and identities. Add instrument schemas, preview validation, duplicate handling, and fictional fixtures with hand-checked expected results. |
| `app.js`, `index.html`, `style.css` | Extend current profile, dashboard, evidence views, and help controls. Keep time, units, source, owner, action, and textual status readable with color removed. |
| `sw.js`, `server.js`, `README.md` | Serve and cache required local assets. Document first-load preparation, import formats, fictional rules, and the exact offline demonstration. |

1. Run `npm test` before the first change and after each milestone. Check threshold equality, missing fields, out-of-order records, re-imports, corrections, and imported observations created by earlier app versions.
2. Run the app locally with `npm start`. Use keyboard navigation to open each alert, inspect its source, assign its follow-up, and record its outcome. Repeat with an older saved profile and both existing health CSVs.
3. Prepare the offline cache, disconnect and stop the local server, then close and reopen the app. Complete one case per hazard. Simulate an interrupted save or competing tab edit and verify the newer data survives and the UI reports the failure.
4. Run one mixed scenario with two astronauts. Show a shared cabin warning, a personal dose gap, and a pending landing assessment at the same time. Verify personal records stay with their astronaut, cabin data stays with its mission, and exported handoffs contain only selected fields.
5. For operational use, replace fictional rules and procedures with versioned mission-approved material, validate instrument calibration and data handling against actual devices, enforce authenticated access, and verify delivery receipts against the communications service. Real-time alarms also require a validated live feed and verified alert delivery. Imported logs support retrospective review.
