import { hazardColumns } from './hazard-csv.js';
import { systemMeasurements, systems } from './model.js';

export function currentMissionRows(rows) {
  const replaced = new Set(rows.map(row => row.replaces_id).filter(Boolean));
  return rows.filter(row => !replaced.has(row.record_id));
}
export function missionCsv(rows) {
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return hazardColumns.join(',') + '\n' + rows.map(row => hazardColumns.map(key => cell(row[key])).join(',')).join('\n') + '\n';
}
export function separateDemo(rows, suffix) {
  const namespaces = new Map();
  return rows.map(row => {
    if (!namespaces.has(row.mission_id)) namespaces.set(row.mission_id, row.mission_id.slice(0, 60) + '-DEMO-' + suffix);
    return { ...row, mission_id: namespaces.get(row.mission_id), data_kind: 'synthetic' };
  });
}
export function scenarioTime(rows) {
  return rows.map(row => row.imported_at_utc || row.timestamp_utc || row.interval_end_utc).filter(Boolean).sort().at(-1) || new Date().toISOString();
}
const personal = (rows, who) => rows.filter(row => row.astronaut_id === who);
const usable = row => row.quality === 'valid' && !['fault', 'uncertain', 'invalid'].includes(row.clock_status) &&
  !['expired', 'invalid'].includes(row.calibration_status);
const seconds = (end, start) => (Date.parse(end) - Date.parse(start)) / 1000;
const crossed = (value, rule) => ({ '>': value > +rule.value, '<': value < +rule.value, '>=': value >= +rule.value, '<=': value <= +rule.value })[rule.comparison] === true;
function lastQuantity(rows, quantity) {
  return rows.filter(row => row.quantity === quantity && row.record_type !== 'demo_rule' && usable(row))
    .sort((a, b) => (a.timestamp_utc || a.interval_end_utc).localeCompare(b.timestamp_utc || b.interval_end_utc)).at(-1);
}

export function demoCoverage(all, who) {
  const rows = currentMissionRows(all);
  const own = personal(rows, who);
  const measurements = systems.map(system => ({
    id: system.id, label: system.label,
    complete: systemMeasurements(rows, system.id, who).length > 0
  }));
  const has = type => own.some(row => row.record_type === type);
  const hazardChecks = [
    { id: 'radiation', label: 'Dosimeter readings, device assignment and activity log', complete: has('device_assignment') && has('spacewalk') && !!lastQuantity(own, 'personal_dose_equivalent') && rows.some(row => row.record_type === 'demo_rule' && row.quantity === 'personal_dose_equivalent') },
    { id: 'wellbeing', label: 'Sleep duration, sleep opportunity, mood and check-in request', complete: ['sleep_hours', 'sleep_opportunity_hours', 'mood'].every(key => !!lastQuantity(own, key)) && has('support_request') },
    { id: 'distance', label: 'Case notes, assigned check, local procedure and handoff', complete: has('incident') && has('task') && has('handoff') && rows.some(row => row.record_type === 'demo_procedure' && row.record_id === own.find(item => item.record_type === 'incident')?.procedure_id) },
    { id: 'gravity', label: 'Environment transition, symptom and linked assessment', complete: has('gravity_transition') && has('symptom') && has('assessment_task') },
    { id: 'habitat', label: 'Cabin CO₂, pressure and temperature readings', complete: ['co2', 'cabin_pressure', 'cabin_temperature'].every(key => !!lastQuantity(rows.filter(row => row.compartment_id), key) && rows.some(row => row.record_type === 'demo_rule' && row.quantity === key)) }
  ];
  return [...measurements, ...hazardChecks];
}
function procedureFor(rows, id) { return rows.find(row => row.record_type === 'demo_procedure' && row.record_id === id); }

export function analyseMission(mission, profile) {
  if (!mission) return { findings: [], summaries: [] };
  const summaries = [];
  const all = mission.records;
  const rows = currentMissionRows(all);
  const who = profile.astronautId;
  const own = personal(rows, who);
  const now = mission.evaluationTime || scenarioTime(rows);
  const findings = [];
  const actions = mission.actions || {};
  function add(id, system, label, value, reference, evidence, procedureId, options = {}) {
    const source = evidence[0];
    const rule = evidence.find(row => row.record_type === 'demo_rule' && row.unit === options.unit &&
      ['<', '>'].includes(row.comparison) && row.value !== '' && Number.isFinite(+row.value));
    const samples = rule ? evidence.filter(row => row.record_type === 'measurement' && row.quantity === rule.quantity && row.unit === rule.unit) : [];
    const numericValue = typeof value === 'number' ? value :
      samples.length ? (rule.comparison === '>' ? Math.max(...samples.map(row => +row.value)) : Math.min(...samples.map(row => +row.value))) : null;
    const range = options.range || (rule && Number.isFinite(numericValue) ? {
      value: numericValue, low: rule.comparison === '<' ? +rule.value : null,
      high: rule.comparison === '>' ? +rule.value : null, unit: rule.unit, peak: samples.length > 1
    } : null);
    findings.push({
      id: 'mission-' + id, key: 'mission', missionFinding: true, system, label, value, reference,
      unit: options.unit || '', rule: options.rule || 'Demo mission evaluation v1',
      record: { id: source?.record_id || id, time: source?.timestamp_utc || source?.interval_end_utc || now, day: source?.day || profile.day, source: source?.source || 'Imported mission evidence', importFile: source?.importFile, importRow: source?.importRow, importedAt: source?.importedAt, context: options.detail || '' },
      evidenceIds: evidence.map(row => row.record_id), procedureId,
      procedure: procedureFor(rows, procedureId), detail: options.detail || '',
      astronautId: options.astronautId || source?.astronaut_id || '', restricted: options.restricted || source?.visibility === 'restricted-support' || source?.record_type === 'support_request',
      taskId: options.taskId, urgent: options.urgent || false, range,
      healthConcern: Boolean(range || evidence.some(row => ['incident', 'symptom', 'support_request'].includes(row.record_type))),
      review: actions['mission-' + id], evaluationTime: now
    });
  }

  // Form dose segments only where the instrument, assignment and documented interval support them.
  const doseRows = own.filter(row => ['personal_dose_equivalent', 'personal_dose_equivalent_rate'].includes(row.quantity) && row.record_type !== 'demo_rule');
  function verified(row) {
    return row.reading_type !== 'point_sample' && usable(row) && row.clock_status === 'verified' && ['valid', 'valid-demo'].includes(row.calibration_status) &&
      own.some(assignment => assignment.record_type === 'device_assignment' && assignment.source_id === row.source_id &&
        assignment.interval_start_utc <= (row.interval_start_utc || row.timestamp_utc) &&
        assignment.interval_end_utc >= (row.interval_end_utc || row.timestamp_utc));
  }
  const excludedDose = doseRows.filter(row => !verified(row));
  if (excludedDose.length) add('instrument-quality', 'exposure', 'Dosimeter readings need verification', excludedDose.length + ' readings lack the checks required for dose totals', 'Valid quality, verified clock, calibration and astronaut assignment required', excludedDose, 'PROC-RAD');
  const segments = [];
  for (const row of doseRows.filter(row => ['interval_dose', 'interval_average_rate'].includes(row.reading_type) && verified(row))) {
    segments.push({ start: row.interval_start_utc, end: row.interval_end_utc, dose: row.reading_type === 'interval_dose' ? +row.value : +row.value * seconds(row.interval_end_utc, row.interval_start_utc) / 3600, evidence: [row] });
  }
  const counters = new Map();
  for (const row of doseRows.filter(row => row.reading_type === 'cumulative_counter')) {
    const key = row.source_id + '|' + row.counter_session;
    if (!counters.has(key)) counters.set(key, []);
    counters.get(key).push(row);
  }
  for (const group of counters.values()) {
    group.sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));
    for (let i = 1; i < group.length; i++) {
      const before = group[i - 1], after = group[i];
      if (!verified(before) || !verified(after)) continue;
      if (after.reset_flag === 'true' || +after.value < +before.value || after.timestamp_utc <= before.timestamp_utc) {
        add('counter-' + after.record_id, 'exposure', 'Dosimeter continuity needs review', 'Counter reset or decrease', 'Continuous counter session required', [before, after], 'PROC-RAD');
        continue;
      }
      segments.push({ start: before.timestamp_utc, end: after.timestamp_utc, dose: +after.value - +before.value, evidence: [before, after] });
    }
  }
  for (const walk of own.filter(row => row.record_type === 'spacewalk')) {
    const candidates = segments.filter(segment => segment.start >= walk.interval_start_utc && segment.end <= walk.interval_end_utc);
    const overlaps = candidates.filter((segment, index) => candidates.some((other, j) => index !== j && segment.start < other.end && other.start < segment.end));
    const accepted = candidates.filter(segment => !overlaps.includes(segment));
    const dose = accepted.reduce((sum, segment) => sum + segment.dose, 0);
    const covered = accepted.reduce((sum, segment) => sum + seconds(segment.end, segment.start), 0);
    const missing = Math.max(0, seconds(walk.interval_end_utc, walk.interval_start_utc) - covered) / 60;
    summaries.push({ system: 'exposure', label: walk.record_id, dose, coveredMinutes: covered / 60, missingMinutes: missing, overlaps: overlaps.length });
    const evidence = [walk, ...new Set(accepted.flatMap(segment => segment.evidence))];
    if (missing || overlaps.length) add('coverage-' + walk.record_id, 'exposure', 'Spacewalk dose coverage needs review', missing + ' minutes uncovered', 'Full spacewalk coverage; overlaps excluded', [walk, ...doseRows], walk.procedure_id, { detail: dose + ' uSv recorded. ' + overlaps.length + ' overlapping segments excluded.' });
    const rule = rows.find(row => row.record_type === 'demo_rule' && row.quantity === 'personal_dose_equivalent' && row.unit === 'uSv' && +row.window_seconds === seconds(walk.interval_end_utc, walk.interval_start_utc));
    if (rule && crossed(dose, rule)) add('dose-' + walk.record_id, 'exposure', 'Recorded spacewalk dose exceeds demo threshold', Number(dose.toFixed(3)), rule.comparison + ' ' + rule.value + ' uSv over ' + rule.window_seconds + ' s', [...evidence, rule], rule.procedure_id, { unit: 'uSv', rule: rule.rule_id, detail: covered / 60 + ' minutes covered; ' + missing + ' minutes uncovered.' });
  }
  const missionSegments = segments.filter((segment, index) => !segments.some((other, j) => index !== j && segment.start < other.end && other.start < segment.end));
  if (doseRows.length) summaries.push({ system: 'exposure', label: 'Recorded mission total', dose: missionSegments.reduce((sum, segment) => sum + segment.dose, 0), coveredMinutes: missionSegments.reduce((sum, segment) => sum + seconds(segment.end, segment.start), 0) / 60, missingMinutes: null });
  for (const row of doseRows.filter(row => row.quantity === 'personal_dose_equivalent_rate' && verified(row))) {
    const rule = rows.find(item => item.record_type === 'demo_rule' && item.quantity === row.quantity && item.unit === row.unit && +item.window_seconds === seconds(row.interval_end_utc, row.interval_start_utc));
    if (rule && crossed(+row.value, rule)) add('rate-' + row.record_id, 'exposure', 'Dose rate exceeds demo threshold', +row.value, rule.comparison + ' ' + rule.value + ' ' + rule.unit, [row, rule], rule.procedure_id, { unit: row.unit, rule: rule.rule_id });
  }

  const sleep = lastQuantity(own, 'sleep_hours');
  const opportunity = own.find(row => row.quantity === 'sleep_opportunity_hours' && row.mission_day === sleep?.mission_day && usable(row));
  if (sleep && opportunity && +sleep.value < 7) {
    add('sleep-' + sleep.record_id, 'sleep', +opportunity.value <= +sleep.value ? 'Review available rest time' : 'Review interrupted sleep', +sleep.value, 'Fictional minimum 7 h; available ' + opportunity.value + ' h', [sleep, opportunity], 'PROC-SLEEP', { unit: 'h', range: { value: +sleep.value, low: 7, high: null, unit: 'h' }, detail: +opportunity.value <= +sleep.value ? 'Recorded sleep used the full available rest period. Review the duty schedule.' : 'Available rest exceeded actual sleep. Record interruptions and review the next rest period.' });
  }
  for (const request of own.filter(row => row.record_type === 'support_request')) {
    if (actions['task-' + request.record_id]?.status !== 'completed' && request.status !== 'completed') add('support-' + request.record_id, 'sleep', 'Crew check-in requested', request.status, 'Request remains independent of mood and sleep', [request], request.procedure_id, { taskId: request.record_id, detail: 'Recipient ' + request.recipient_id + '. Private support notes are excluded from ground handoff exports.' });
  }

  const transitions = own.filter(row => row.record_type === 'gravity_transition');
  for (const symptom of own.filter(row => row.record_type === 'symptom' && row.related_ids)) {
    const linked = symptom.related_ids.split('|');
    const transition = transitions.find(row => linked.includes(row.record_id) || linked.includes(row.replaces_id));
    if (!transition || !symptom.timestamp_utc) continue;
    const minutes = seconds(symptom.timestamp_utc, transition.timestamp_utc) / 60;
    const task = own.find(row => row.record_type === 'assessment_task' && row.related_ids.split('|').includes(symptom.record_id));
    add('gravity-' + symptom.record_id, symptom.body_system || 'head', 'Gravity-transition assessment', minutes + ' minutes ' + (minutes >= 0 ? 'after transition' : 'before transition'), transition.from_environment + ' to ' + transition.to_environment, [symptom, transition, ...(task ? [task] : [])], task?.procedure_id || 'PROC-GRAV', { taskId: task?.record_id, detail: task ? 'Assessment ' + task.record_id + ' due ' + task.due_at_utc + '. ' + (actions['task-' + task.record_id]?.status || task.status) : 'Assign a linked assessment.' });
  }

  // Only complete documented interval averages qualify for interval rules.
  for (const rule of rows.filter(row => row.record_type === 'demo_rule' && ['co2', 'cabin_pressure', 'cabin_temperature'].includes(row.quantity))) {
    const measurements = rows.filter(row => row.record_type === 'measurement' && row.quantity === rule.quantity && row.unit === rule.unit && row.compartment_id && usable(row));
    for (const point of measurements.filter(row => row.reading_type === 'point_sample' && crossed(+row.value, rule))) {
      add('cabin-point-' + point.record_id, 'operations', 'Cabin point reading needs review', point.value, rule.comparison + ' ' + rule.value + ' ' + rule.unit + ' demo reference', [point, rule], rule.procedure_id, { unit: rule.unit, detail: point.compartment_id + ' · Single timestamp observation. Duration and interval-average exposure are unknown.' });
    }
    for (const compartment of new Set(measurements.map(row => row.compartment_id))) {
      const samples = measurements.filter(row => row.compartment_id === compartment).sort((a, b) => (a.interval_start_utc || a.timestamp_utc).localeCompare(b.interval_start_utc || b.timestamp_utc));
      const excursions = samples.filter(row => row.reading_type === 'interval_average' && seconds(row.interval_end_utc, row.interval_start_utc) >= +rule.window_seconds && crossed(+row.value, rule));
      const episodes = [];
      for (const row of excursions) {
        const previous = episodes.at(-1);
        if (previous && row.interval_start_utc <= previous.end) { previous.end = row.interval_end_utc > previous.end ? row.interval_end_utc : previous.end; previous.rows.push(row); }
        else episodes.push({ start: row.interval_start_utc, end: row.interval_end_utc, rows: [row] });
      }
      for (const episode of episodes) {
        const symptoms = rows.filter(row => row.record_type === 'symptom' && row.compartment_id === compartment && row.timestamp_utc >= episode.start && row.timestamp_utc <= episode.end);
        add('cabin-' + rule.rule_id + '-' + compartment + '-' + episode.start, 'operations', 'Historical ' + ({ co2: 'cabin CO₂', cabin_temperature: 'cabin temperature', cabin_pressure: 'cabin pressure' }[rule.quantity]) + ' excursion', episode.rows.map(row => row.value).join(', '), rule.comparison + ' ' + rule.value + ' ' + rule.unit, [...episode.rows, rule, ...symptoms], rule.procedure_id, { unit: rule.unit, rule: rule.rule_id, detail: compartment + ' · ' + episode.start + ' to ' + episode.end + '. ' + symptoms.length + ' symptom report(s) overlap in this compartment; cause requires review.' });
      }
      const last = samples.toSorted((a, b) => (a.interval_end_utc || a.timestamp_utc).localeCompare(b.interval_end_utc || b.timestamp_utc)).at(-1);
      const age = seconds(now, last.interval_end_utc || last.timestamp_utc);
      if (age > +rule.freshness_seconds) add('freshness-' + rule.quantity + '-' + compartment, 'operations', 'Cabin record needs an update', Math.floor(age / 60) + ' minutes old', 'Demo freshness ' + rule.freshness_seconds + ' s', [last, rule], rule.procedure_id, { detail: 'Last valid ' + rule.quantity + ' in ' + compartment + ': ' + last.value + ' ' + last.unit + '. Historical data cannot establish current cabin conditions.' });
    }
  }
  for (const task of rows.filter(row => ['task', 'assessment_task'].includes(row.record_type) && (!row.astronaut_id || row.astronaut_id === who))) {
    const status = actions['task-' + task.record_id]?.status || task.status;
    if (status === 'completed') continue;
    add('task-' + task.record_id, task.body_system || 'operations', seconds(now, task.due_at_utc) >= 0 ? 'Crew action overdue' : 'Crew action scheduled', task.due_at_utc, 'Owner ' + task.owner_id, [task], task.procedure_id || 'PROC-CASE', { taskId: task.record_id, detail: task.text });
  }
  for (const incident of own.filter(row => row.record_type === 'incident' && actions['task-' + row.record_id]?.status !== 'completed')) {
    const reviewed = actions['mission-case-' + incident.record_id]?.actions?.length;
    add('case-' + incident.record_id, incident.body_system || 'lungs', incident.text?.trim() || 'Onboard case requires crew review',
      reviewed ? 'Action recorded; follow-up remains open' : 'Crew review required', 'Follow the local demo checklist', [incident], incident.procedure_id,
      { urgent: incident.status === 'open', detail: incident.text, taskId: incident.record_id });
  }
  for (const handoff of own.filter(row => row.record_type === 'handoff')) add('handoff-' + handoff.record_id, 'operations', 'Ground handoff status', mission.exports?.[handoff.record_id] ? 'Exported · delivery unconfirmed' : handoff.status, 'Ground receipt requires explicit confirmation', [handoff], 'PROC-CASE', { detail: handoff.text });
  for (const task of (mission.manualTasks || []).filter(task => !task.astronautId || task.astronautId === who)) {
    if (actions['task-' + task.id]?.status === 'completed') continue;
    add(task.id, 'operations', seconds(now, task.due) >= 0 ? 'Assigned check overdue' : 'Assigned check scheduled', task.due, 'Owner ' + task.owner, [], 'PROC-CASE', { taskId: task.id, detail: task.text, astronautId: task.astronautId, restricted: task.restricted });
  }
  return { findings, summaries };
}
export function evaluateMission(mission, profile) { return analyseMission(mission, profile).findings; }

export function recordMissionAction(mission, finding, note, owner, due, time, completed = false) {
  if (!note.trim() || !owner.trim()) throw Error('Record the action and responsible crew member.');
  if (due && (!Number.isFinite(Date.parse(due)) || Date.parse(due) <= Date.parse(time))) throw Error('Next check must be a valid future UTC time in the scenario.');
  mission.actions ||= {};
  const metadata = { astronautId: finding.astronautId || '', restricted: !!finding.restricted };
  const entry = mission.actions[finding.id] ||= { actions: [], ...metadata };
  entry.actions.push({ time, note: note.trim(), owner, due });
  if (finding.taskId && completed) {
    mission.actions['task-' + finding.taskId] ||= { actions: [], ...metadata };
    mission.actions['task-' + finding.taskId].status = 'completed';
    mission.actions['task-' + finding.taskId].actions.push({ time, note: note.trim(), owner });
  }
  if (due) {
    mission.manualTasks ||= [];
    mission.manualTasks.push({ id: 'assigned-' + mission.manualTasks.length, findingId: finding.id, owner, due, text: note.trim(), ...metadata });
  }
}
export function handoffSnapshot(mission, who, selectedIds, question, at) {
  if (!question.trim()) throw Error('Enter the question for the ground reviewer.');
  const rows = currentMissionRows(mission.records).filter(row => selectedIds.includes(row.record_id));
  if (rows.some(row => row.visibility === 'restricted-support' || row.record_type === 'support_request' || (row.astronaut_id && row.astronaut_id !== who))) throw Error('Private or other-crew records cannot be included.');
  return { id: 'export-' + who + '-' + at, astronautId: who, createdAt: at, question: question.trim(), delivery: 'unconfirmed', records: rows.map(row => Object.fromEntries(hazardColumns.map(key => [key, row[key]]))) };
}
