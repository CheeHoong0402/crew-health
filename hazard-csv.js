import { freshProfile, validateRecord, systems } from './model.js';

export const hazardColumns = 'record_type record_id mission_id astronaut_id mission_day data_kind timestamp_utc reported_at_utc imported_at_utc interval_start_utc interval_end_utc compartment_id source_id quantity value unit reading_type quality clock_status calibration_status counter_session reset_flag body_system posture activity from_environment to_environment status owner_id recipient_id due_at_utc procedure_id procedure_version related_ids replaces_id correction_reason rule_id comparison window_seconds freshness_seconds coverage_required visibility text expected_result'.split(' ');
const types = new Set('astronaut compartment demo_procedure device_assignment spacewalk measurement wellbeing support_request crew_action task expectation gravity_transition symptom assessment_task assessment_result exercise lab_result incident handoff handoff_reply demo_rule'.split(' '));
const units = {
  personal_dose_equivalent: 'uSv', personal_dose_equivalent_rate: 'uSv/h',
  sleep_hours: 'h', sleep_opportunity_hours: 'h', mood: 'category',
  heart_rate: 'bpm', systolic_pressure: 'mmHg', diastolic_pressure: 'mmHg',
  co2: 'ppm', cabin_pressure: 'kPa', cabin_temperature: 'degC',
  visual_acuity_decimal: 'decimal', lumbar_bone_mineral_density: 'g/cm2',
  grip_strength: 'kgf', completed_duration: 'min', sound_level: 'dBA',
  illuminance: 'lux', relative_humidity: 'percent',
  surface_microbial_count: 'CFU/cm2', white_blood_cell_count: '10^9/L'
};
const healthKeys = { heart_rate: 'pulse', systolic_pressure: 'systolic', diastolic_pressure: 'diastolic', sleep_hours: 'sleep', mood: 'mood' };
const utcFields = hazardColumns.filter(key => key.endsWith('_utc'));
const numeric = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
function validUtc(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value;
}
function identity(row) { return row.mission_id + '/' + row.record_id; }
function signature(row) {
  return JSON.stringify(hazardColumns.filter(key => key !== 'imported_at_utc').map(key => row[key]));
}
function refs(row) {
  return ['related_ids', 'replaces_id', 'procedure_id', 'astronaut_id', 'compartment_id'].flatMap(key =>
    row[key].split('|').filter(Boolean).map(id => ({ key, id })));
}
export function parseHazardRows(headers, rows) {
  for (const key of hazardColumns) if (!headers.includes(key)) throw Error('Missing combined-format column ' + key + '.');
  for (const key of headers) if (!hazardColumns.includes(key)) throw Error('Unknown combined-format column ' + key + '.');
  const seen = new Map();
  return rows.map((cells, index) => {
    try {
      if (cells.length !== headers.length) throw Error('Column count does not match the header.');
      const row = Object.fromEntries(headers.map((key, i) => [key, cells[i]]));
      for (const key of ['record_id', 'mission_id']) if (!/^[A-Za-z0-9_.-]{1,100}$/.test(row[key])) throw Error('Invalid ' + key + '.');
      if (['__proto__', 'constructor', 'prototype'].includes(row.mission_id) || ['__proto__', 'constructor', 'prototype'].includes(row.record_id)) throw Error('Reserved identifier.');
      if (!types.has(row.record_type)) throw Error('Unknown record_type.');
      if (!['synthetic', 'observed'].includes(row.data_kind)) throw Error('Invalid data_kind.');
      if (!/^\d+$/.test(row.mission_day) || +row.mission_day < 1 || +row.mission_day > 10000) throw Error('Invalid mission_day.');
      for (const key of utcFields) if (row[key] && !validUtc(row[key])) throw Error('Invalid UTC timestamp in ' + key + '.');
      if (!['valid', 'sensor_fault', 'suspect', 'missing'].includes(row.quality)) throw Error('Invalid quality.');
      if (!['crew', 'restricted-support'].includes(row.visibility)) throw Error('Invalid visibility.');
      if (row.body_system && !systems.some(system => system.id === row.body_system)) throw Error('Invalid body_system.');
      for (const key of ['window_seconds', 'freshness_seconds']) if (row[key] && (!/^\d+$/.test(row[key]) || +row[key] < 1)) throw Error('Invalid ' + key + '.');
      if (row.comparison && !['>', '<', '>=', '<='].includes(row.comparison)) throw Error('Invalid comparison.');
      if (row.reset_flag && !['true', 'false'].includes(row.reset_flag)) throw Error('Invalid reset_flag.');
      if (row.text.length > 4000 || row.expected_result.length > 4000) throw Error('Text exceeds 4000 characters.');
      for (const { id } of refs(row)) if (!/^[A-Za-z0-9_.-]{1,100}$/.test(id)) throw Error('Invalid linked identifier.');
      if (Object.values(row).some(value => value.length > 4000)) throw Error('Field exceeds 4000 characters.');
      if (['symptom', 'incident', 'support_request', 'crew_action', 'task', 'assessment_task', 'handoff', 'handoff_reply'].includes(row.record_type) && !row.timestamp_utc) throw Error('Event requires timestamp_utc.');
      const untimed = ['astronaut', 'compartment', 'demo_procedure', 'demo_rule', 'expectation', 'device_assignment', 'spacewalk'];
      if (!untimed.includes(row.record_type) && !row.timestamp_utc && !row.interval_start_utc) throw Error('Record requires an observation time or interval.');
      if (['wellbeing', 'symptom', 'incident', 'gravity_transition', 'exercise', 'assessment_result', 'assessment_task', 'support_request'].includes(row.record_type) && !row.astronaut_id) throw Error('Personal record requires astronaut_id.');
      if (['measurement', 'lab_result'].includes(row.record_type) && !row.astronaut_id && !row.compartment_id) throw Error('Measurement needs astronaut or compartment scope.');
      if (row.record_type === 'demo_rule' && (!row.rule_id || !row.comparison || !row.window_seconds || !row.procedure_id || !row.procedure_version)) throw Error('Rule needs versioned identity, operator, window and procedure.');
      const intervalTypes = ['spacewalk', 'device_assignment'];
      const intervalReading = ['interval_dose', 'interval_average_rate', 'interval_average'].includes(row.reading_type);
      if (intervalTypes.includes(row.record_type) || intervalReading || row.interval_start_utc || row.interval_end_utc) {
        if (!row.interval_start_utc || !row.interval_end_utc || row.interval_end_utc <= row.interval_start_utc) throw Error('Provide an ordered start/end interval.');
      }
      if (['measurement', 'wellbeing', 'assessment_result', 'exercise', 'lab_result', 'demo_rule'].includes(row.record_type)) {
        if (!(row.quantity in units) || row.unit !== units[row.quantity]) throw Error('Unsupported quantity or mismatched unit.');
        if (row.quantity === 'mood') {
          if (!['Very low', 'Low', 'Neutral', 'Good', 'Very good'].includes(row.value)) throw Error('Invalid mood.');
        } else if (!numeric.test(row.value) || !Number.isFinite(+row.value)) throw Error('Enter a finite nonnegative value.');
        if (!row.timestamp_utc && !row.interval_start_utc && row.record_type !== 'demo_rule') throw Error('Measurement needs a time or interval.');
        if (['sleep_hours', 'sleep_opportunity_hours'].includes(row.quantity) && +row.value > 24) throw Error('Sleep durations must be at most 24 hours.');
        if (row.quantity === 'relative_humidity' && +row.value > 100) throw Error('Humidity must be at most 100 percent.');
      }
      if (row.record_type === 'measurement' && !['point_sample', 'interval_average', 'interval_dose', 'interval_average_rate', 'cumulative_counter', ''].includes(row.reading_type)) throw Error('Invalid reading_type.');
      if (row.reading_type === 'cumulative_counter' && (!row.counter_session || !row.timestamp_utc)) throw Error('Counter requires a session and timestamp.');
      if (['task', 'assessment_task'].includes(row.record_type) && (!row.owner_id || !row.due_at_utc || !row.status)) throw Error('Task requires owner, UTC deadline and status.');
      if (row.record_type === 'gravity_transition' && (!row.timestamp_utc || !row.from_environment || !row.to_environment)) throw Error('Transition needs time and environments.');
      if (row.replaces_id && (!row.correction_reason || row.replaces_id === row.record_id)) throw Error('Correction needs an original ID and reason.');
      const id = identity(row);
      if (seen.has(id) && seen.get(id) !== signature(row)) throw Error('Conflicting record_id in file.');
      seen.set(id, signature(row));
      return { ...row, format: 'hazards', id, day: +row.mission_day, time: row.timestamp_utc || row.interval_end_utc || row.imported_at_utc, source: row.data_kind === 'synthetic' ? 'CSV Ãƒâ€šÃ‚Â· Synthetic' : 'CSV Ãƒâ€šÃ‚Â· Observed', values: {}, importRow: index + 2 };
    } catch (error) { throw Error('CSV row ' + (index + 2) + ': ' + error.message); }
  });
}

export function appendHazardCsv(state, records, filename) {
  const nextMissions = structuredClone(state._missions || {});
  const now = new Date().toISOString();
  let added = 0;
  for (const row of records) {
    const mission = nextMissions[row.mission_id] ||= { records: [] };
    const existing = mission.records.find(item => item.record_id === row.record_id);
    if (existing) {
      if (signature(existing) !== signature(row)) throw Error('Conflicting record ' + row.record_id + '. Use a new ID and replaces_id for a correction.');
      continue;
    }
    mission.records.push({ ...row, importFile: filename, importedAt: now });
    added++;
  }
  const affected = [...new Set(records.map(row => row.mission_id))];
  for (const missionId of affected) {
    const all = nextMissions[missionId].records;
    const byId = new Map(all.map(row => [row.record_id, row]));
    for (const row of all) {
      for (const { key, id } of refs(row)) {
        const target = byId.get(id);
        if (!target) throw Error('Record ' + row.record_id + ' links to missing ' + id + '.');
        const expectedType = { astronaut_id: 'astronaut', compartment_id: 'compartment', procedure_id: 'demo_procedure' }[key];
        if (expectedType && target.record_type !== expectedType) throw Error('Wrong linked record type for ' + key + '.');
      }
      if (row.replaces_id) {
        const chain = new Set([row.record_id]);
        let cursor = row;
        while (cursor.replaces_id) {
          if (chain.has(cursor.replaces_id)) throw Error('Correction cycle.');
          chain.add(cursor.replaces_id);
          cursor = byId.get(cursor.replaces_id);
        }
        if (row.astronaut_id !== byId.get(row.replaces_id).astronaut_id || row.quantity !== byId.get(row.replaces_id).quantity) throw Error('Correction must retain astronaut and quantity.');
        if (row.record_type !== byId.get(row.replaces_id).record_type) throw Error('Correction must retain record_type.');
        if (all.filter(item => item.replaces_id === row.replaces_id).length > 1) throw Error('Original already has a correction.');
      }
    }
  }
  // Stage every profile before mutating the caller, including validation of projected vitals.
  const profiles = {};
  for (const missionId of affected) {
    const all = nextMissions[missionId].records;
    const replaced = new Set(all.map(row => row.replaces_id).filter(Boolean));
    const current = all.filter(row => !replaced.has(row.record_id));
    for (const crew of current.filter(row => row.record_type === 'astronaut')) {
      const key = 'mission-' + missionId + ':' + crew.record_id;
      const profile = structuredClone(state[key] || freshProfile(false));
      profile.missionId = missionId;
      profile.astronautId = crew.record_id;
      profile.label = (crew.data_kind === 'synthetic' ? 'Synthetic Ãƒâ€šÃ‚Â· ' : '') + missionId + ' Ãƒâ€šÃ‚Â· ' + crew.record_id;
      profile.personal ||= {};
      profile.personal.astronautId = crew.record_id;
      profile.personal.missionName = missionId;
      const personal = current.filter(row => row.astronaut_id === crew.record_id);
      const groups = new Map();
      for (const row of personal.filter(row => healthKeys[row.quantity] && row.quality === 'valid')) {
        const groupKey = [row.timestamp_utc, row.posture, row.activity].join('|');
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(row);
      }
      const activeProjectionIds = new Set();
      for (const group of groups.values()) {
        const first = group[0];
        const id = 'hazard-health-' + group.map(row => row.id).sort().join('|');
        activeProjectionIds.add(id);
        if (profile.records.some(row => row.id === id)) continue;
        const values = Object.fromEntries(group.map(row => [healthKeys[row.quantity], row.quantity === 'mood' ? row.value : +row.value]));
        // Partial cuffs stay available as raw evidence until both pressures are present.
        if ((values.systolic === undefined) !== (values.diastolic === undefined)) { delete values.systolic; delete values.diastolic; }
        if (!Object.keys(values).length) continue;
        const record = { id, hazardProjection: true, day: first.day, time: first.timestamp_utc, phase: profile.phase, source: first.source, values, importFile: filename, importedAt: now, importRow: first.importRow, context: [first.posture, first.activity, first.text].filter(Boolean).join(' Ãƒâ€šÃ‚Â· '), related: group.map(row => row.record_id).join('|') };
        validateRecord(record);
        profile.records.push(record);
      }
      for (const record of profile.records.filter(row => row.hazardProjection)) record.retired = !activeProjectionIds.has(record.id);
      const retired = new Set(profile.records.filter(row => row.retired).map(row => row.id));
      for (const record of profile.records) if (record.replaces && retired.has(record.replaces)) { record.retired = true; retired.add(record.id); }
      for (const event of profile.events.filter(row => row.hazardSource)) {
        if (!personal.some(row => row.id === event.hazardSource)) event.outcome ||= 'Source superseded by imported correction';
      }
      for (const row of personal.filter(row => ['symptom', 'incident'].includes(row.record_type))) {
        const id = 'hazard-event-' + row.id;
        if (!profile.events.some(event => event.id === id)) profile.events.push({ id, hazardSource: row.id, system: row.body_system || 'operations', text: row.text || row.record_type, time: row.timestamp_utc || row.reported_at_utc, day: row.day, urgent: row.record_type === 'incident', owner: row.owner_id || 'Crew medical officer', outcome: '', acknowledged: '' });
      }
      profile.day = Math.max(profile.day, ...personal.map(row => row.day));
      profiles[key] = profile;
    }
  }
  const target = Object.keys(profiles)[0];
  if (!target) throw Error('Combined CSV must include an astronaut record.');
  state._missions = nextMissions;
  Object.assign(state, profiles);
  return { added, target };
}
