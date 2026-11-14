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
