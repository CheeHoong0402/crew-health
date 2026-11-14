import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, sleepFlag, validateRecord, latest, validatePersonal } from './model.js';

test('sleep follow-up respects missing days, corrections and current mission day', () => {
  const profile = freshProfile(true);
  assert.ok(sleepFlag(profile));
  profile.day = 43;
  assert.equal(sleepFlag(profile), null);
  profile.day = 42;
  profile.records[0].day = 40;
  assert.equal(sleepFlag(profile), null);
  profile.records[0].day = 41;
  profile.records.push({ ...profile.records[1], id: 'correction', replaces: 'demo-42', values: { sleep: 8 } });
  assert.equal(sleepFlag(profile), null);
  assert.equal(latest(profile.records, 'sleep').values.sleep, 8);
  assert.equal(profile.records.length, 3);
});
test('zero sleep is valid, malformed readings and partial pressure are rejected', () => {
  const record = { ...freshProfile(true).records[0], values: { sleep: 0 } };
  assert.doesNotThrow(() => validateRecord(record));
  for (const values of [{ sleep: -1 }, { sleep: 25 }, { pulse: Infinity }, { systolic: 120 }, { systolic: 70, diastolic: 90 }, { mood: 'unknown' }, {}]) {
    assert.throws(() => validateRecord({ ...record, values }));
  }
});
test('personal fields validate optional details and reject invalid dates or measurements', () => {
  const blank = { name: '', astronautId: '', missionName: '', crewRole: '', dateOfBirth: '', heightCm: '', weightKg: '', bloodGroup: '' };
  assert.doesNotThrow(() => validatePersonal(blank));
  assert.doesNotThrow(() => validatePersonal({ ...blank, name: 'Demo astronaut', astronautId: 'A-07', dateOfBirth: '1990-01-02', heightCm: '178', weightKg: '75', bloodGroup: 'O+' }));
  for (const invalid of [{ dateOfBirth: '1990-02-30' }, { dateOfBirth: '2990-01-01' }, { weightKg: '-1' }, { heightCm: 'bad' }, { bloodGroup: 'other' }]) {
    assert.throws(() => validatePersonal({ ...blank, ...invalid }));
  }
});

test('event acknowledgment retains action text and closure retains earlier updates', async () => {
  const { updateEvent } = await import('./model.js');
  const event = { outcome: '' };
  updateEvent(event, 'ack', 'Crew assessment requested', '2026-11-14T14:20:00Z');
  assert.equal(event.outcome, '');
  assert.equal(event.actions[0].text, 'Crew assessment requested');
  assert.throws(() => updateEvent(event, 'close', ' ', '2026-11-14T14:25:00Z'));
  assert.equal(event.actions.length, 1);
  updateEvent(event, 'close', 'Assessment completed', '2026-11-14T14:30:00Z');
  assert.equal(event.actions.length, 2);
  assert.equal(event.outcome, 'Assessment completed');
});

test('body alerts use the selected profile and region, and stay visible until closure', async () => {
  const { openRegionEvents } = await import('./model.js');
  const crew = freshProfile(true);
  crew.events[0].acknowledged = '2026-11-14T14:20:00Z';
  assert.equal(openRegionEvents(crew, 'lungs').length, 1);
  assert.equal(openRegionEvents(crew, 'heart').length, 0);
  assert.equal(openRegionEvents(freshProfile(false), 'lungs').length, 0);
  crew.events[0].outcome = 'Assessment complete';
  assert.equal(openRegionEvents(crew, 'lungs').length, 0);
});

test('all supported indicators produce body findings from CSV and manual records', async () => {
  const { readingFindings, addObservation, reviewFinding } = await import('./model.js');
  const { parseCsv, appendCsv } = await import('./csv.js');
  const crew = freshProfile(false);
  const text = 'mission_day,timestamp_utc,phase,data_kind,heart_rate_bpm,systolic_mmhg,diastolic_mmhg,temperature_c,sleep_hours,mood,glucose_mgdl\n43,2026-11-15T08:10:00Z,Transit,synthetic,150,180,110,39,3,Low,220';
  const records = await parseCsv(text);
  appendCsv(crew, records, 'abnormal.csv');
  assert.equal(readingFindings(crew).length, 7);
  const finding = readingFindings(crew)[0];
  reviewFinding(crew, finding.id, 'Repeat requested', '2026-11-15T08:20:00Z');
  assert.equal(readingFindings(crew)[0].review.actions.length, 1);
  assert.equal(readingFindings(crew).length, 7);
  assert.equal(appendCsv(crew, records, 'renamed.csv'), 0);
  const normal = { id: 'normal', day: 44, time: '2026-11-16T08:10:00Z', phase: 'Recovery', values: { pulse: 70, systolic: 120, diastolic: 80, temperature: 36.8, sleep: 8, mood: 'Good', glucose: 95 } };
  addObservation(crew, normal);
  assert.equal(crew.day, 44);
  assert.equal(crew.phase, 'Recovery');
  assert.equal(readingFindings(crew).length, 0);
});

test('demo boundaries, missing values, corrections and zero sleep recalculate correctly', async () => {
  const { readingFindings, addObservation } = await import('./model.js');
  const crew = freshProfile(false);
  const boundary = { id: 'boundary', day: 43, time: '2026-11-15T08:10:00Z', phase: 'Transit', values: { pulse: 50, systolic: 140, diastolic: 90, temperature: 37.5, sleep: 7, glucose: 70 } };
  addObservation(crew, boundary);
  assert.equal(readingFindings(crew).length, 0);
  addObservation(crew, { ...boundary, id: 'bad', values: { sleep: 0 }, time: '2026-11-15T09:10:00Z' });
  assert.equal(readingFindings(crew)[0].key, 'sleep');
  addObservation(crew, { ...boundary, id: 'fixed', replaces: 'bad', values: { sleep: 8 }, time: '2026-11-15T09:10:00Z' });
  assert.equal(readingFindings(crew).length, 0);
  assert.equal(crew.records.length, 3);
});
