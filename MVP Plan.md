# Astronaut health monitoring dashboard plan

The dashboard serves two users. An astronaut needs to see what changed, what to do onboard, and when the next check is due. A mission scientist needs to see which observations support a finding, how they were collected, and what evidence is missing. The crew medical officer and flight surgeon receive clinical handoffs. A scientist can flag a questionable observation or request a repeat through the mission workflow. Clinical decisions and operational alert limits belong to the mission medical team.

## What appears on the tablet

| Region | Astronaut view | Mission scientist view |
|---|---|---|
| Mission header | Own profile, mission day and phase, onboard UTC, last local save, access to crew help. | Authorized participant identifier, mission phase, observation time, last data received, and transmission delay. A delayed copy carries its age. |
| Attention queue | Show unresolved items by urgency, then due time. Each has a plain-language action and an owner. Urgent crew help is accessible even with no measurements or connection. | Show newly shared events, outstanding repeat requests, and data-quality issues. Open the original observation directly from a flag. |
| Anatomical map | Front and back figure with selectable eyes, head and inner ear, chest, abdomen, kidneys, spine, limbs and skin. Select a region to see associated observations and symptoms. Provide the same choices in a keyboard-accessible list. | The same regions filter the participant timeline. Compare preflight, in-flight and postflight observations, with changes of posture, instrument, shift or gravity marked. |
| Selected system | Latest value, unit, age, method, personal reference if available, seven-day history with visible gaps, and next action. Show an unmeasured system as “No exam on file.” | Raw values and repeats, baseline period and sample count, instrument or self-report, quality flags, corrections and reasons. A repeat request links to the resulting observation. |
| Mission context | Show sleep and wellbeing, nutrition, exposure, cabin and suit conditions, and operational events outside the body map. Display relevant items during a spacewalk, landing or gravity transition. | Align the exposure or event interval with measurements using UTC. Keep personal, cabin, suit and research measurements identifiable. Temporal overlap alone does not establish a cause. |

Use dark navy for the tablet canvas, high-contrast type, cyan for the selected region, amber for review and red for immediate action. Give warning text and the next action more space than the anatomy illustration. The figure locates evidence; coloring an entire organ would imply more than a single measurement establishes. The overview has no health score, gamification, crew rankings, decorative animation or general wellness feed.

## Source coverage and evidence required

The [challenge brief](./Challenge%20Description.docx) names six useful indicators. Capture resting heart rate in bpm, systolic and diastolic blood pressure in mmHg, temperature in °C with method, glucose in mg/dL with meal timing, sleep hours over the preceding 24 hours, and self-reported mood. Enter what was actually obtained. Preserve original units, timestamp and source. A measurement of zero, an unscheduled test, an overdue scheduled test, a rejected reading and an absent baseline are distinct states.

### Five mission hazards

| Hazard | Mission context to retain |
|---|---|
| Space radiation | Exposure interval, instrument, measured quantity, unit, location and whether the result belongs to the astronaut or the compartment. Identify neutron measurements where available. |
| Isolation and confinement | Shift, workload, time in isolation, sleep disruption and privately reported wellbeing; share only authorized fields. |
| Distance from Earth | Time data left the spacecraft and reached the reviewer; local access to procedures during delays, equipment failures, limited resupply or medical emergencies. Local export means prepared, with delivery explicitly tracked if supported. |
| Changes in gravity | Preflight, transit, surface, re-entry and recovery phase; posture and activity at measurement so like conditions can be compared. |
| Hostile or closed habitat | Cabin or suit location, pressure, oxygen, carbon dioxide, temperature, illumination, noise, crowding and microbial sampling when available. Display sensor time and place beside any crew report. |

These five hazards can interact. They describe circumstances in which to interpret observations. [NASA hazard overview](https://www.nasa.gov/hrp/hazards/) · [CSA deep-space research context](https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp)

### All 17 categories on NASA’s human spaceflight risk overview

The numbers below are local checklist numbers. Every category has an evidence destination. In the MVP, the six basic readings, crew-reported events, sleep follow-up and scientist review are demonstrable. Specialized tests and telemetry have an explicit availability state until a verified source supplies them. [NASA risk overview](https://www.nasa.gov/hrp/risks/)

| # | Risk to account for | What the astronaut or scientist can inspect |
|---|---|---|
| 1 | Changed immune response | Whole-body and skin symptoms, rash location, temperature trend and any available lab result. Viral reactivation and susceptibility to infection or allergies require additional evidence. |
| 2 | Sensorimotor and vestibular impairment | Head and inner ear: dizziness, motion sickness, disorientation, balance, gait, eye–hand coordination or slower reflexes; link timed task results and gravity transition if available. |
| 3 | Cardiovascular adaptation or events | Heart and vessels: resting pulse, paired cuff pressure, posture, lightheadedness or fainting. Keep vascular stiffness, fluid shifts, venous flow and coagulation findings tied to the relevant exam. |
| 4 | Decompression sickness | Spacewalk or pressure transition: event time, recorded pressure history, reported symptoms and medical review state. The crew can report an urgent concern immediately. |
| 5 | Changed interactions with microorganisms | Skin and gut symptoms plus linked specimen results. Cabin, food-system or crop-hardware microbial samples retain their location and specimen source. |
| 6 | Hypoxia | Breathing and spacewalk context: distinguish personal oxygen saturation, if measured, from suit or cabin oxygen and pressure. Display instrument quality and symptoms. |
| 7 | Inadequate food or nutrition | Intake, missed meals, appetite or menu fatigue, supply context and scheduled glucose with meal timing. A single glucose reading cannot establish nutritional adequacy. |
| 8 | Spacewalk injury or impaired performance | Record suit event, injury site, cognitive fatigue and task impact alongside available pressure, low oxygen or elevated carbon dioxide observations. |
| 9 | Declining cardiorespiratory and musculoskeletal fitness | Exercise workload, performance and recovery under comparable conditions. Strength, muscle mass and conditioning need their own assessment. |
| 10 | Spaceflight-associated neuro-ocular syndrome (SANS) | Eyes and head: crew-reported vision change, eye exam, retinal imaging or qualified review. Link relevant research on fluid movement and pressure. |
| 11 | Spaceflight-related bone changes | Hips, spine and limbs: bone-density study, fracture or pain report and prior exam. Exercise and time in microgravity provide context for bone loss and fragility. |
| 12 | Behavioral changes and psychiatric disorders | Private mood, stress, reported distress and support request. A qualified assessment is needed to establish a disorder. |
| 13 | Teamwork breakdown | Restricted operational event for communication errors, team tension or coordination problems. Assign a reviewer without ranking individual crewmembers. |
| 14 | Sleep loss and irregular schedules | Sleep duration, shift, workload and personal preflight reference. Display consecutive affected days and gaps for investigating fatigue and circadian disruption. |
| 15 | Inadequate operational support | Log inaccessible procedures, equipment or software failure, unavailable training or delayed ground support when they affect care or task performance. |
| 16 | Injury from dynamic loads | At re-entry or landing, retain event time, pain or discomfort, body site and available vehicle load record. Route an injury report to the medical team. |
| 17 | Radiation-induced cancer | Exposure history with source and coverage interval. Long-term cancer risk belongs in research context. An exposure record alone cannot diagnose disease or provide an individual cancer probability. |

### Findings that need more detail than the 17 category names

| Where to find it | Additional scope from the supplied material | Evidence to display |
|---|---|---|
| Blood and bone marrow | Altered blood-cell production, anemia and low white blood cell count, with implications for infection vulnerability and radiation sensitivity. | A dated blood count with units, reference and reviewer. Temperature alone cannot establish these changes. [CSA body infographic](https://www.asc-csa.gc.ca/eng/multimedia/search/image/8056) |
| Metabolism and vessels | Insulin resistance, type 2 diabetes and vascular stiffening; the CSA also discusses aging, inactivity, osteoporosis, balance problems and cardiovascular disease as Earth research applications. | Glucose context and available clinician-reviewed or study-specific results. Preserve the distinction between an individual exam and an Earth analogy. [CSA body infographic](https://www.asc-csa.gc.ca/eng/multimedia/search/image/8056) · [CSA space research](https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp) |
| Kidneys and hydration | Dehydration, calcium excretion and kidney-stone risk during adaptation to altered gravity. | Fluid intake, symptoms and verified urine or imaging results when collected. [NASA gravity fields](https://www.nasa.gov/hrp/hazard-gravity-fields/) |
| Eyes, brain and radiation | Cataracts, DNA damage, possible central nervous system injury, and changes in cognition, movement and behavior. Keep SANS and cataracts individually identifiable. | Link the exposure interval, eye exam, performance assessment or research assay to its own source. Neutron field readings and personal accumulated dose have different meanings. [CSA body infographic](https://www.asc-csa.gc.ca/eng/multimedia/search/image/8056) · [NASA radiation hazard](https://www.nasa.gov/hrp/hazard-space-radiation/) · [CSA radiation instruments](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp) |
| Research record | Immune and spinal-fluid biomarkers, venous blood flow and clotting changes, spinal scans, food acceptance, physiology, exercise, sleep, piloting and re-entry performance. | Link authorized exam, study, specimen or device record to the astronaut and collection time. Show research findings and countermeasure studies as research; any crew treatment instruction requires its mission protocol. [NASA ongoing research](https://www.nasa.gov/hrp/ongoing-hrp-research/) |

## Readable warnings and indicators

Keep two independent labels on a record: **action urgency** and **evidence quality**. A crew-reported urgent event remains visible even when a sensor is offline. Each message shows the trigger, event time, responsible person, next action and due time. Opening or acknowledging an item records who saw it; closing it requires an outcome. Repeat measurements append to the same event.

| Visible label | Example display and action |
|---|---|
| **Act now** · red octagon with exclamation mark | **Crew reports an urgent breathing concern during a spacewalk.** Reported by crew at 14:12 UTC. Suit oxygen reading unavailable. **Crew medical officer: open the onboard emergency procedure now.** Ground delivery status appears separately. |
| **Review** · amber triangle | **Review sleep schedule at the next check-in.** Day 41: 5.5 h. Day 42: 5 h. Personal preflight reference: 7–8 h. Crew reported a shift change. **Astronaut: record follow-up on day 43.** |
| **Measurement due** · clock | **Repeat scheduled blood pressure.** Show the scheduled time, last valid observation and device procedure. Close when the repeat or reason for deferral is recorded. |
| **Data unavailable** · open circle | **Personal radiation exposure unknown for this interval.** Show last received time and sensor identity if known. **Scientist: check coverage before interpreting this interval.** An unscheduled glucose measurement simply reads “Not scheduled.” |

The sleep example is a fictional demonstration rule. Two consecutive measured days below the fictional personal reference open one follow-up; a missing day breaks the sequence and a corrected reading recalculates it. The example urgent event is triggered by the astronaut’s explicit report. Numeric urgent alerts require an applicable mission-approved rule, version, unit, valid input and protocol reference. Reserve the top of the screen for items that require action; retain resolved alerts and data gaps in history.

## Data flow and smallest demonstrable release

1. **Capture onboard.** Use an offline tablet check-in with six optional indicators, event time, source, unit, activity or meal context and crew notes. Keep a clearly labeled simulated profile separate from manual entries. Show saved, failed and pending states. Preserve original observations when corrected or repeated.
2. **Review onboard.** Link symptoms, readings and follow-ups to the body system or exposure panel. Show seven mission days with a value table. Provide sourced measurement explanations and locally available procedure references. The astronaut chooses which fields and notes to release in a clinical or research handoff.
3. **Inspect as a scientist.** Open an authorized, participant-coded handoff. Plot comparable observations, inspect their sources, flag a suspect reading and record a repeat request. Show when the source was captured and when the reviewer received it. Copying a handoff does not imply it was delivered or reviewed.
4. **Extend only when evidence exists.** First integrations should be selected against a mission instrument or verified study export. Dosimetry, suit and cabin streams, laboratory results and imaging each need their own units, identity, coverage interval and quality checks. Shared real crew records require authenticated roles and authorized access.

## Acceptance scenarios

- **Astronaut.** Within two minutes, find the two short nights, identify the personal reference, record the shift change, and schedule day 43 follow-up offline. A skipped glucose field still reads “Not scheduled”; zero hours of sleep remains a valid entry.
- **Scientist.** Reconstruct the same flag from the released source observations and baseline. Identify a changed method, a stale ground copy and a missing day. Correcting a reading preserves its original and updates the flag. A private note omitted from the handoff stays inaccessible.
- **Urgent event.** Open crew help from any anatomy selection with no network or sensor reading. Present the local procedure first. Verify that acknowledging an event leaves its follow-up open.
- **Coverage and readability.** Locate every risk in the table by body system or mission context. With color removed, identify the action, owner and deadline from the text and symbol alone. A missing eye exam, bone scan or dosimeter interval never displays as a favorable result.

**Review boundary.** The official [Space Apps resources tab](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/?tab=resources) was inaccessible directly. The [local event listing](https://hackathlone.com/challenges/health-monitoring-software) identifies the five agency resources reviewed here. Coverage includes the local brief, those five publications, NASA’s five linked hazard summaries and the CSA body infographic. Individual research papers and every nested link in the agencies’ archives fall outside this inventory. The supplied pages provide scientific context; the dashboard examples use fictional readings and events.
