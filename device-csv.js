import { hazardColumns, parseHazardRows, appendHazardCsv } from './hazard-csv.js';
import { deviceConfig } from './device-config.js';

const observationRequired = 'record_id mission_id mission_day data_kind timestamp_utc quantity value unit source_id reading_type quality'.split(' ');
const observationColumns = [...observationRequired, ...'astronaut_id compartment_id interval_start_utc interval_end_utc clock_status calibration_status counter_session reset_flag posture activity text replaces_id correction_reason'.split(' ')];
export const deviceUnits = {
  heart_rate: 'bpm', systolic_pressure: 'mmHg', diastolic_pressure: 'mmHg', body_temperature: 'degC',
  oxygen_saturation: 'percent', respiratory_rate: 'breaths/min', blood_glucose: 'mg/dL', fluid_intake: 'mL/24h',
  urine_specific_gravity: 'ratio', sleep_hours: 'h', visual_acuity_decimal: 'decimal', lumbar_bone_mineral_density: 'g/cm2',
  grip_strength: 'kgf', completed_duration: 'min', balance_task_duration: 's', white_blood_cell_count: '10^9/L',
  surface_microbial_count: 'CFU/cm2', personal_dose_equivalent: 'uSv', personal_dose_equivalent_rate: 'uSv/h',
  co2: 'ppm', cabin_pressure: 'kPa', cabin_temperature: 'degC', relative_humidity: 'percent', sound_level: 'dBA', illuminance: 'lux'
};
export const deviceRequired = ['record_id', 'timestamp'];
const rowContext = 'astronaut_id compartment_id correction_reason'.split(' ');
const instrumentFields = 'source_id quality reading_type interval_start_utc interval_end_utc clock_status calibration_status counter_session reset_flag replaces_id posture activity text'.split(' ');
export const deviceColumns = [...deviceRequired, 'mission_id', 'mission_day', 'data_kind', ...rowContext, ...instrumentFields, ...Object.keys(deviceUnits), ...Object.keys(deviceUnits).flatMap(key => instrumentFields.map(field => key + '_' + field))];
const systems = {
  heart_rate: 'heart', systolic_pressure: 'heart', diastolic_pressure: 'heart', body_temperature: 'skin',
  oxygen_saturation: 'lungs', respiratory_rate: 'lungs', blood_glucose: 'abdomen', fluid_intake: 'kidneys',
  urine_specific_gravity: 'kidneys', sleep_hours: 'sleep', visual_acuity_decimal: 'eyes',
  lumbar_bone_mineral_density: 'spine', grip_strength: 'limbs', completed_duration: 'limbs',
  balance_task_duration: 'head', white_blood_cell_count: 'skin', surface_microbial_count: 'skin',
  personal_dose_equivalent: 'exposure', personal_dose_equivalent_rate: 'exposure',
  co2: 'operations', cabin_pressure: 'operations', cabin_temperature: 'operations',
  relative_humidity: 'operations', sound_level: 'operations', illuminance: 'operations'
};
const exams = new Set(['visual_acuity_decimal', 'lumbar_bone_mineral_density', 'grip_strength', 'balance_task_duration']);
const labs = new Set(['white_blood_cell_count', 'surface_microbial_count', 'urine_specific_gravity']);
const blank = () => Object.fromEntries(hazardColumns.map(key => [key, '']));

export function parseDeviceRows(headers, rows) {
  for (const key of observationRequired) if (!headers.includes(key)) throw Error('Missing device column ' + key + '.');
  for (const key of headers) if (!observationColumns.includes(key)) throw Error('Unknown device column ' + key + '. Use the device sample headers.');
  return rows.map((cells, index) => {
    try {
      if (cells.length !== headers.length) throw Error('Column count does not match header.');
      const input = Object.fromEntries(headers.map((key, i) => [key, cells[i]]));
      for (const key of observationRequired) if (!input[key]) throw Error('Enter ' + key + '.');
      if (!systems[input.quantity]) throw Error('Unsupported device quantity ' + input.quantity + '. Self-reports belong in manual entry.');
      const cabin = systems[input.quantity] === 'operations' || input.quantity === 'surface_microbial_count';
      if (cabin && !input.compartment_id) throw Error('Enter the cabin compartment under Measurement context or include compartment_id.');
      if (!cabin && !input.astronaut_id) throw Error('Enter the astronaut ID under Measurement context or include astronaut_id.');
      if (!['point_sample', 'interval_average', 'interval_dose', 'interval_average_rate', 'cumulative_counter', 'previous_24_hours', 'lab_result'].includes(input.reading_type)) throw Error('Invalid reading_type.');
      if (input.clock_status && !['verified', 'uncertain', 'fault'].includes(input.clock_status)) throw Error('Invalid clock_status.');
      if (input.calibration_status && !['valid', 'valid-demo', 'expired', 'invalid', 'unknown'].includes(input.calibration_status)) throw Error('Invalid calibration_status.');
      const row = { ...blank(), ...input, record_type: exams.has(input.quantity) ? 'assessment_result' : labs.has(input.quantity) ? 'lab_result' : input.quantity === 'completed_duration' ? 'exercise' : 'measurement', body_system: systems[input.quantity], visibility: 'crew' };
      // The shared validator handles units, UTC timestamps, values and dose-specific reading types.
      const parsed = parseHazardRows(hazardColumns, [hazardColumns.map(key => row[key])])[0];
      if (row.interval_end_utc && row.timestamp_utc < row.interval_end_utc) throw Error('Collection timestamp must be at or after the interval end.');
      return { ...parsed, format: 'devices', importRow: index + 2 };
    } catch (error) { throw Error('CSV row ' + (index + 2) + ': ' + error.message.replace(/^CSV row 2: /, '')); }
  });
}

export function parseWideDeviceRows(originalHeaders, rows, context = {}) {
  const headers = originalHeaders.map(key => key === 'CO2' ? 'co2' : key);
  if (new Set(headers).size !== headers.length) throw Error('Duplicate device columns.');
  for (const key of deviceRequired) if (!headers.includes(key)) throw Error('Missing device column ' + key + '.');
  for (const key of headers) if (!deviceColumns.includes(key)) throw Error('Unknown device column ' + key + '. Units are fixed by measurement column.');
  const quantities = Object.keys(deviceUnits).filter(key => headers.includes(key));
  if (!quantities.length) throw Error('Include at least one measurement column.');
  const ids = new Set(), times = new Set();
  const dateOf = value => Date.parse(value?.slice(0, 10) + 'T00:00:00Z') / 86400000;
  const dates = rows.map(cells => dateOf(cells[headers.indexOf('timestamp')])).filter(Number.isFinite);
  const lastDate = Math.max(...dates);
  return rows.flatMap((cells, index) => {
    try {
      if (cells.length !== headers.length) throw Error('Column count does not match header.');
      const input = Object.fromEntries(headers.map((key, i) => [key, cells[i]]));
      const inputRow = { ...input };
      if (!input.mission_day && context.mission_day && Number.isFinite(dateOf(input.timestamp))) {
        input.mission_day = String(Number(context.mission_day) - (lastDate - dateOf(input.timestamp)));
        if (+input.mission_day < 1) throw Error('Mission day of the latest timestamp is too early for the dates in this file.');
      }
      for (const key of ['mission_id', 'mission_day', 'data_kind', 'astronaut_id', 'compartment_id']) if (!input[key] && context[key]) input[key] = String(context[key]);
      for (const key of ['mission_id', 'mission_day', 'data_kind']) if (!input[key]) throw Error('Supply ' + key + ' in the file or import context.');
      for (const key of deviceRequired) if (!input[key]) throw Error('Enter ' + key + '.');
      if (!/^[A-Za-z0-9_.-]{1,60}$/.test(input.record_id)) throw Error('record_id must use 1–60 letters, digits, dots, underscores or hyphens.');
      const identity = input.mission_id + '/' + input.record_id;
      const scopeTime = [input.mission_id, input.astronaut_id, input.compartment_id, input.timestamp].join('|');
      if (ids.has(identity)) throw Error('Duplicate timestamp record ID.');
      if (times.has(scopeTime)) throw Error('Combine measurements for the same timestamp, astronaut and compartment into one row.');
      ids.add(identity); times.add(scopeTime);
      const supplied = quantities.filter(key => input[key] !== '');
      if (!supplied.length) throw Error('Enter at least one measurement; leave unmeasured cells blank.');
      return supplied.map(quantity => {
        const row = { ...blank(), ...input, record_id: input.record_id + '.' + quantity, timestamp_utc: input.timestamp, quantity, value: input[quantity], unit: deviceUnits[quantity] };
        for (const field of instrumentFields) row[field] = input[quantity + '_' + field] || input[field] || '';
        row.source_id ||= 'unspecified-device';
        row.quality ||= 'valid';
        row.reading_type ||= labs.has(quantity) ? 'lab_result' : ['sleep_hours','fluid_intake'].includes(quantity) ? 'previous_24_hours' : 'point_sample';
        if (row.replaces_id) row.replaces_id += '.' + quantity;
        const parsed = parseDeviceRows(observationColumns, [observationColumns.map(key => row[key] ?? '')])[0];
        return { ...parsed, importRow: index + 2, inputRow, wideRecordId: input.record_id };
      });
    } catch (error) { throw Error('CSV row ' + (index + 2) + ': ' + error.message.replace(/^CSV row 2: /, '')); }
  });
}

export function deviceCsv(rows, includeMetadata = false) {
  if (!includeMetadata) {
    const groups = new Map();
    const observations = rows.filter(row => systems[row.quantity] && ['measurement', 'wellbeing', 'assessment_result', 'lab_result', 'exercise'].includes(row.record_type) && (!row.quality || row.quality === 'valid'));
    const crew = new Set(observations.map(row => row.astronaut_id).filter(Boolean));
    const missions = new Set(observations.map(row => row.mission_id).filter(Boolean));
    if (crew.size > 1 || missions.size > 1) throw Error('Export one astronaut and mission at a time.');
    for (const row of observations) {
      const timestamp = row.timestamp_utc || row.interval_end_utc;
      if (row.unit !== deviceUnits[row.quantity]) throw Error('Unexpected unit for ' + row.quantity + '.');
      if (!groups.has(timestamp)) groups.set(timestamp, { record_id: 'RECORD-' + String(groups.size + 1).padStart(3, '0'), timestamp });
      const record = groups.get(timestamp);
      if (record[row.quantity] !== undefined && record[row.quantity] !== row.value) throw Error('Conflicting ' + row.quantity + ' at ' + timestamp + '.');
      record[row.quantity] = row.value;
    }
    const columns = [...deviceRequired, ...Object.keys(deviceUnits)];
    const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
    return columns.join(',') + '\n' + [...groups.values()].sort((a,b) => a.timestamp.localeCompare(b.timestamp)).map(row => columns.map(key => cell(row[key])).join(',')).join('\n') + '\n';
  }
  const observations = rows.filter(row => systems[row.quantity] && ['measurement', 'wellbeing', 'assessment_result', 'lab_result', 'exercise'].includes(row.record_type));
  const groups = new Map();
  for (const row of observations) {
    const timestamp = row.timestamp_utc || row.interval_end_utc;
    const key = [row.mission_id, row.astronaut_id, row.compartment_id, timestamp].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const records = [...groups.values()].map(group => {
    const first = group[0];
    const record = { record_id: first.wideRecordId || first.record_id.replace(new RegExp('\\.' + first.quantity + '$'), '').slice(0,60), timestamp: first.timestamp_utc || first.interval_end_utc, mission_id: first.mission_id, mission_day: first.mission_day, data_kind: first.data_kind };
    for (const field of rowContext) {
      if (group.some(row => (row[field] || '') !== (first[field] || ''))) throw Error('Conflicting ' + field + ' at ' + record.timestamp + '. Preserve the original source file.');
      if (first[field]) record[field] = first[field];
    }
    for (const row of group) {
      if (record[row.quantity] !== undefined) throw Error('Multiple ' + row.quantity + ' values at ' + record.timestamp + '. Resolve the source conflict before export.');
      if (row.unit !== deviceUnits[row.quantity]) throw Error('Unexpected unit for ' + row.quantity + '.');
      record[row.quantity] = row.value;
      for (const field of instrumentFields) if (row[field]) {
        const value = field === 'replaces_id' ? row[field].replace(new RegExp('\\.' + row.quantity + '$'), '') : row[field];
        if (group.every(item => item[field] === row[field])) record[field] = value;
        else record[row.quantity + '_' + field] = value;
      }
    }
    return record;
  }).sort((a,b) => a.timestamp.localeCompare(b.timestamp));
  const columns = deviceColumns.filter(key => deviceRequired.includes(key) || records.some(row => row[key] !== undefined));
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return columns.join(',') + '\n' + records.map(row => columns.map(key => cell(row[key])).join(',')).join('\n') + '\n';
}

export function appendDeviceCsv(state, observations, filename, astronautId = '') {
  const expanded = [];
  for (const missionId of new Set(observations.map(row => row.mission_id))) {
    const own = observations.filter(row => row.mission_id === missionId);
    const kind = own.every(row => row.data_kind === 'synthetic') ? 'synthetic' : 'observed';
    const base = { ...blank(), mission_id: missionId, mission_day: own.at(-1).mission_day, data_kind: kind, quality: 'valid', visibility: 'crew' };
    const existing = state._missions?.[missionId]?.records || [];
    if (own.some(row => row.data_kind !== kind) || existing.some(row => row.data_kind !== kind)) throw Error('Synthetic and observed records need separate mission IDs.');
    const crew = new Set([...own.map(row => row.astronaut_id), ...existing.filter(row => row.record_type === 'astronaut').map(row => row.record_id)].filter(Boolean));
    if (!crew.size && astronautId) crew.add(astronautId);
    if (!crew.size) throw Error('For cabin-only data, select a profile with an astronaut ID or include an astronaut observation.');
    const add = row => { if (!existing.some(item => item.record_id === row.record_id)) expanded.push({ ...base, ...row }); };
    for (const id of crew) add({ record_id: id, record_type: 'astronaut', astronaut_id: id });
    for (const id of new Set(own.map(row => row.compartment_id).filter(Boolean))) add({ record_id: id, record_type: 'compartment' });
    for (const config of deviceConfig) add(config);
    expanded.push(...own);
    // The astronaut/device pairing is explicit in each source row; no spacewalk or incident is inferred.
    for (const row of own.filter(row => row.quantity.startsWith('personal_dose'))) {
      const start = row.interval_start_utc || row.timestamp_utc;
      const end = row.interval_end_utc || new Date(Date.parse(row.timestamp_utc) + 1000).toISOString().replace('.000Z', 'Z');
      add({ record_id: 'ASSIGN-' + row.record_id, record_type: 'device_assignment', astronaut_id: row.astronaut_id, source_id: row.source_id, interval_start_utc: start, interval_end_utc: end, text: 'Device-to-astronaut association supplied in observation ' + row.record_id });
    }
  }
  const validated = parseHazardRows(hazardColumns, expanded.map(row => hazardColumns.map(key => row[key])));
  for (const row of validated) {
    const original = observations.find(item => item.mission_id === row.mission_id && item.record_id === row.record_id);
    if (original) row.importRow = original.importRow;
  }
  const staged = structuredClone(state);
  const result = appendHazardCsv(staged, validated, filename);
  for (const id of new Set(observations.map(row => row.mission_id))) {
    const mission = staged._missions[id];
    mission.inputFormat = 'devices';
    const synthetic = observations.filter(row => row.mission_id === id).every(row => row.data_kind === 'synthetic');
    mission.evaluationTime = synthetic ? mission.records.filter(row => row.quantity && row.record_type !== 'demo_rule').map(row => row.timestamp_utc || row.interval_end_utc).filter(Boolean).sort().at(-1) : new Date().toISOString();
    for (const row of mission.records.filter(row => ['demo_rule', 'demo_procedure'].includes(row.record_type) && row.importFile === filename)) {
      row.importFile = 'Built-in demo configuration';
      row.importRow = null;
    }
  }
  Object.assign(state, staged);
  return result;
}
