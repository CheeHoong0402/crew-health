import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv, appendCsv, csvTestProfile } from './csv.js';
import { freshProfile, sleepFlag } from './model.js';

const header = 'mission_day,timestamp_utc,phase,data_kind,sleep_hours,context\n';

test('both supplied scenarios import independently and exercise the sleep rule', async () => {
  for (const [filename, warning] of [['healthy-data.csv', false], ['unhealthy-data.csv', true]]) {
    const records = await parseCsv(await readFile(new URL('data/testing/' + filename, import.meta.url), 'utf8'));
    assert.equal(records.length, 7);
    const profile = csvTestProfile(records, filename);
    assert.equal(appendCsv(profile, records, filename), 7);
    assert.equal(profile.day, 49);
    assert.equal(Boolean(sleepFlag(profile)), warning);
    assert.equal(profile.events.length, 0);
    assert.equal(appendCsv(profile, records, filename), 0);
    assert.equal(profile.records.length, 7);
    assert.equal(profile.records[0].importFile, filename);
    assert.equal(profile.records[0].source, 'CSV · Synthetic');
  }
});
test('BOM, CRLF, quoted commas, escaped quotes and newlines preserve valid fields and zero', async () => {
  const text = '\uFEFF' + header.replace('\n', '\r\n') + '42,2026-11-14T08:10:00Z,Transit,synthetic,0,"Shift changed, ""late""\r\nCrew note"\r\n';
  const [record] = await parseCsv(text);
  assert.equal(record.values.sleep, 0);
  assert.equal(record.context, 'Shift changed, "late"\r\nCrew note');
  const second = await parseCsv(header + '42,2026-11-14T08:10:00Z,Transit,synthetic,0,"Shift changed, ""late""\r\nCrew note"');
  assert.equal(second[0].id, record.id);
});
test('invalid rows reject the whole file and identify the failed row', async () => {
  for (const bad of [
    '42,2026-02-30T08:10:00Z,Transit,synthetic,8,',
    '42,2026-11-14T08:10:00,Transit,synthetic,8,',
    '42,2026-11-14T08:10:00Z,Transit,synthetic,25,',
    '42,2026-11-14T08:10:00Z,Transit,unknown,8,',
    '42,2026-11-14T08:10:00Z,Transit,synthetic,Infinity,'
  ]) {
    await assert.rejects(parseCsv(header + '41,2026-11-13T08:10:00Z,Transit,synthetic,8,\n' + bad), /CSV row 3/);
  }
  await assert.rejects(parseCsv(header + '42,2026-11-14T08:10:00Z,Transit,synthetic,8,"unclosed'), /Unclosed/);
  await assert.rejects(parseCsv(header + '42,2026-11-14T08:10:00Z,Transit,synthetic,8,"ok"bad'), /closing quote/);
  await assert.rejects(parseCsv(header + '42,2026-11-14T08:10:00Z,Transit,synthetic,8'), /Column count/);
  await assert.rejects(parseCsv(header.replace('context', 'sleep_hours') + '42,2026-11-14T08:10:00Z,Transit,synthetic,8,'), /duplicate column/);
  await assert.rejects(parseCsv('x'.repeat(1024 * 1024 + 1)), /1 MB/);
});
test('blank values stay absent and observed records retain source without gaining a baseline', async () => {
  const records = await parseCsv('mission_day,timestamp_utc,phase,data_kind,heart_rate_bpm,sleep_hours\n42,2026-11-14T08:10:00Z,Transit,observed,64,');
  assert.equal(records[0].values.sleep, undefined);
  assert.equal(records[0].source, 'CSV · Observed');
  const profile = freshProfile(false);
  appendCsv(profile, records, 'instrument.csv');
  assert.equal(profile.baseline, null);
  assert.throws(() => csvTestProfile(records, 'instrument.csv'), /synthetic rows only/);
});
test('a reimport never resurrects an observation that has an audited correction', async () => {
  const records = await parseCsv(header + '42,2026-11-14T08:10:00Z,Transit,synthetic,5,');
  const profile = csvTestProfile(records, 'test.csv');
  appendCsv(profile, records, 'test.csv');
  profile.records.push({ ...records[0], id: 'correction', replaces: records[0].id, values: { sleep: 8 } });
  assert.equal(appendCsv(profile, records, 'test.csv'), 0);
  assert.equal(profile.records.length, 2);
});

test('import keeps source row and import time without changing duplicate identity', async () => {
  const records = await parseCsv(header + '42,2026-11-14T08:10:00Z,Transit,synthetic,5,');
  const profile = freshProfile(false);
  appendCsv(profile, records, 'first.csv');
  assert.equal(profile.records[0].importRow, 2);
  assert.ok(Number.isFinite(Date.parse(profile.records[0].importedAt)));
  const importedAt = profile.records[0].importedAt;
  assert.equal(appendCsv(profile, records, 'renamed.csv'), 0);
  assert.equal(profile.records[0].importFile, 'first.csv');
  assert.equal(profile.records[0].importedAt, importedAt);
});

test('combined fixture imports all records, isolates crew, preserves fields and deduplicates', async () => {
  const { appendHazardCsv, hazardColumns } = await import('./hazard-csv.js');
  const rows = await parseCsv(await readFile(new URL('data/testing/five-hazards-synthetic.csv', import.meta.url), 'utf8'));
  const state = { legacy: freshProfile(true) };
  const result = appendHazardCsv(state, rows, 'five.csv');
  assert.equal(result.added, 66);
  assert.equal(state._missions['SYNTH-MISSION-01'].records.length, 66);
  const first = state[result.target];
  assert.equal(first.astronautId, 'A-07');
  assert.equal(first.records.length, 4);
  assert.ok(first.events.some(event => event.text.includes('dizziness')));
  const second = Object.values(state).find(item => item.astronautId === 'A-08');
  assert.equal(second.records.length, 0);
  assert.equal(second.events.length, 1);
  for (const field of hazardColumns) assert.equal(state._missions['SYNTH-MISSION-01'].records[0][field], rows[0][field]);
  assert.equal(appendHazardCsv(state, rows, 'renamed.csv').added, 0);
  assert.equal(state.legacy.records.length, 2);
  const snapshot = structuredClone(state);
  const conflict = { ...rows.find(row => row.record_id === 'RAD-112'), value: '999' };
  assert.throws(() => appendHazardCsv(state, [conflict], 'bad.csv'), /Conflicting/);
  assert.deepEqual(state, snapshot);
  const broken = rows.map(row => row.record_id === 'EVA-01' ? { ...row, related_ids: 'MISSING' } : row);
  const empty = {};
  assert.throws(() => appendHazardCsv(empty, broken, 'broken.csv'), /missing/);
  assert.deepEqual(empty, {});
});
test('combined parser rejects bad times, units, values and missing columns', async () => {
  const text = await readFile(new URL('data/testing/five-hazards-synthetic.csv', import.meta.url), 'utf8');
  await assert.rejects(parseCsv(text.replace('uSv', 'mystery')), /unit/);
  await assert.rejects(parseCsv(text.replace('2026-12-03T12:00:00Z', '2026-02-30T12:00:00Z')), /timestamp/);
  await assert.rejects(parseCsv(text.replace('record_type', 'unknown_type')), /column/);
  await assert.rejects(parseCsv(text.replace('SYNTH-MISSION-01', '__proto__')), /Reserved/);
  await assert.rejects(parseCsv(text.replace('RAD-112', 'RAD-100')), /Conflicting/);
});
test('combined health source correction retires derived values and keeps originals', async () => {
  const { appendHazardCsv } = await import('./hazard-csv.js');
  const rows = await parseCsv(await readFile(new URL('data/testing/five-hazards-synthetic.csv', import.meta.url), 'utf8'));
  const state = {};
  const {target} = appendHazardCsv(state, rows, 'five.csv');
  const source = rows.find(row => row.record_id === 'WELL-61-SLEEP');
  const correction = { ...source, record_id: 'SLEEP-FIX', id: source.mission_id + '/SLEEP-FIX', replaces_id: source.record_id, correction_reason: 'Test correction', value: '8' };
  appendHazardCsv(state, [correction], 'fix.csv');
  const { latest } = await import('./model.js');
  assert.equal(latest(state[target].records, 'sleep').values.sleep, 8);
  assert.ok(state[target].records.some(row => row.retired));
  assert.equal(state._missions[source.mission_id].records.length, 67);
  assert.equal(appendHazardCsv(state, rows, 'again.csv').added, 0);
});
