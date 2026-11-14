import { validateRecord, freshProfile } from './model.js';

export const csvColumns = {
  heart_rate_bpm: 'pulse',
  systolic_mmhg: 'systolic',
  diastolic_mmhg: 'diastolic',
  temperature_c: 'temperature',
  sleep_hours: 'sleep',
  mood: 'mood',
  glucose_mgdl: 'glucose'
};
const required = ['mission_day', 'timestamp_utc', 'phase', 'data_kind'];
const allowed = [...required, ...Object.keys(csvColumns), 'context'];
export const csvLimit = 1024 * 1024;

function readRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;
  function finishField() {
    row.push(field.trim());
    field = '';
    closed = false;
  }
  function finishRow() {
    finishField();
    if (row.some(value => value !== '')) rows.push(row);
    row = [];
    if (rows.length > 1001) throw Error('Use at most 1000 data rows per file.');
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      finishRow();
    } else if (closed) throw Error('Unexpected text after a closing quote in CSV row ' + (rows.length + 1) + '.');
    else if (char === '"') {
      if (field) throw Error('Quote must start a field in CSV row ' + (rows.length + 1) + '.');
      quoted = true;
    } else field += char;
  }
  if (quoted) throw Error('Unclosed quoted field.');
  if (field || row.length || closed) finishRow();
  return rows;
}

export async function parseCsv(text) {
  if (new TextEncoder().encode(text).length > csvLimit) throw Error('CSV files must be 1 MB or smaller.');
  const [headers, ...rows] = readRows(text.replace(/^\uFEFF/, ''));
  if (!headers || !rows.length) throw Error('Include a header and at least one data row.');
  if (new Set(headers).size !== headers.length) throw Error('CSV contains duplicate column names.');
  for (const column of required) if (!headers.includes(column)) throw Error('Missing required column ' + column + '.');
  for (const column of headers) if (!allowed.includes(column)) throw Error('Unknown column ' + column + '. Use the sample file headers.');
  const records = [];
  for (const [index, row] of rows.entries()) {
    try {
      if (row.length !== headers.length) throw Error('Column count does not match the header.');
      const fields = Object.fromEntries(headers.map((header, position) => [header, row[position]]));
      if (!['synthetic', 'observed'].includes(fields.data_kind)) throw Error('data_kind must be synthetic or observed.');
      const stamp = fields.timestamp_utc;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(stamp) || Number.isNaN(Date.parse(stamp)) || new Date(stamp).toISOString().replace('.000Z', 'Z') !== stamp) {
        throw Error('timestamp_utc must be a valid UTC date such as 2026-11-14T08:10:00Z.');
      }
      if (!/^\d+$/.test(fields.mission_day)) throw Error('mission_day must be a whole number.');
      if ((fields.context || '').length > 1000) throw Error('Context must be 1000 characters or shorter.');
      const values = {};
      for (const [column, key] of Object.entries(csvColumns)) {
        if (fields[column] === undefined || fields[column] === '') continue;
        if (key !== 'mood' && !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(fields[column])) throw Error('Use a decimal number for ' + column + '.');
        values[key] = key === 'mood' ? fields[column] : Number(fields[column]);
      }
      const record = {
        day: Number(fields.mission_day), time: new Date(stamp).toISOString(), phase: fields.phase,
        source: fields.data_kind === 'synthetic' ? 'CSV · Synthetic' : 'CSV · Observed',
        values, context: fields.context || '', note: ''
      };
      validateRecord(record);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(record)));
      record.id = 'csv-' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      record.importRow = index + 2;
      records.push(record);
    } catch (error) { throw Error('CSV row ' + (index + 2) + ': ' + error.message); }
  }
  return records;
}

export function appendCsv(profile, records, filename) {
  const importedAt = new Date().toISOString();
  const ids = new Set(profile.records.map(record => record.id));
  let added = 0;
  for (const record of records) {
    if (ids.has(record.id)) continue;
    profile.records.push({ ...record, importFile: filename, importedAt });
    ids.add(record.id);
    added++;
  }
  // Import moves the overview to the latest mission day represented on this profile.
  const last = profile.records.toSorted((a, b) => a.day - b.day || a.time.localeCompare(b.time)).at(-1);
  profile.day = Math.max(profile.day, last.day);
  if (last.day === profile.day) profile.phase = last.phase;
  return added;
}

export function csvTestProfile(records, filename) {
  if (!records.every(record => record.source === 'CSV · Synthetic')) throw Error('A synthetic test profile accepts synthetic rows only.');
  const profile = freshProfile(false);
  profile.day = Math.max(...records.map(record => record.day));
  profile.label = 'Synthetic CSV · ' + filename;
  profile.baseline = { low: 7, high: 8, source: 'Fictional preflight reference', count: null };
  return profile;
}
