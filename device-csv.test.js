import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv } from './csv.js';
import { deviceCsv, deviceUnits, appendDeviceCsv } from './device-csv.js';
import { analyseMission } from './mission-demo.js';
import { sleepFlag, readingFindings, latest } from './model.js';

const context = { mission_id: 'M1', mission_day: '1', data_kind: 'observed', astronaut_id: 'A1', compartment_id: 'cabin' };
const minimal = 'record_id,timestamp,heart_rate,CO2,diastolic_pressure\nFRAME-1,2026-11-14T08:00:00Z,120,1200,80\n';
const fixture = async () => parseCsv(await readFile(new URL('data/fixtures/device-timestamp-source-fixture.csv', import.meta.url), 'utf8'));

test('one timestamp row expands fixed-unit columns using explicit import context', async () => {
  const rows = await parseCsv(minimal, context);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row=>[row.quantity,row.value,row.unit]), [['heart_rate','120','bpm'],['diastolic_pressure','80','mmHg'],['co2','1200','ppm']]);
  assert.ok(rows.every(row=>row.importRow===2 && row.wideRecordId==='FRAME-1'));
  const state = {};
  const {target} = appendDeviceCsv(state,rows,'gateway.csv');
  assert.equal(state[target].records[0].values.pulse,120);
  assert.equal(state._missions.M1.records.find(row=>row.record_id==='FRAME-1.heart_rate').importRow,2);
  assert.equal(appendDeviceCsv(state,rows,'renamed.csv').added,0);
  const before=structuredClone(state);
  assert.throws(()=>appendDeviceCsv(state,[{...rows[0],value:'130'}],'bad.csv'), /Conflicting/);
  assert.deepEqual(state,before);
  assert.ok(!state._missions.M1.records.some(row=>['incident','spacewalk','task','support_request'].includes(row.record_type)));
});

test('blank cells stay absent, zero remains valid, and all rows use the same units', async () => {
  const rows=await parseCsv('record_id,timestamp,heart_rate,sleep_hours,co2\nR1,2026-11-14T08:00:00Z,65,0,\nR2,2026-11-14T09:00:00Z,70,,900\n',context);
  assert.equal(rows.length,4);
  assert.equal(rows.find(row=>row.quantity==='sleep_hours').value,'0');
  assert.equal(rows.filter(row=>row.quantity==='co2').length,1);
  for (const row of rows) assert.equal(row.unit,deviceUnits[row.quantity]);
  await assert.rejects(parseCsv(minimal.replace('CO2','co2_mg_m3'),context),/Unknown device column/);
  await assert.rejects(parseCsv(minimal.replace('CO2','unit'),context),/Units are fixed/);
});

test('wide device fixture and exports retain physical values, timing and instrument flags', async () => {
  const rows=await fixture();
  assert.equal(new Set(rows.map(row=>row.importRow)).size,20);
  assert.equal(rows.length,93);
  assert.equal(new Set(rows.map(row=>row.quantity)).size,25);
  assert.ok(!rows.some(row=>['mood','sleep_opportunity_hours'].includes(row.quantity)));
  const roundtrip=await parseCsv(deviceCsv(rows, true));
  const fields=['record_id','timestamp_utc','quantity','value','unit','source_id','quality','reading_type','interval_start_utc','interval_end_utc','clock_status','calibration_status','counter_session','reset_flag'];
  const signature=row=>JSON.stringify(fields.map(key=>row[key]));
  assert.deepEqual(roundtrip.map(signature).sort(),rows.map(signature).sort());
  const state={};
  const {target}=appendDeviceCsv(state,rows,'wide.csv');
  const mission=state._missions[state[target].missionId];
  const result=analyseMission(mission,state[target]);
  assert.equal(result.summaries.find(row=>row.label==='Recorded mission total').dose,25);
  assert.ok(result.findings.some(row=>row.id.startsWith('mission-cabin-')));
  assert.ok(mission.records.filter(row=>row.record_type==='demo_rule').every(row=>row.importFile==='Built-in demo configuration'));
});

test('different sensors within one row retain independent intervals and quality', async () => {
  const csv='record_id,timestamp,heart_rate,co2,co2_reading_type,co2_interval_start_utc,co2_interval_end_utc,co2_quality\nF1,2026-11-14T08:00:00Z,70,6500,interval_average,2026-11-14T07:45:00Z,2026-11-14T08:00:00Z,sensor_fault\n';
  const rows=await parseCsv(csv,context);
  assert.equal(rows.find(row=>row.quantity==='heart_rate').reading_type,'point_sample');
  assert.equal(rows.find(row=>row.quantity==='heart_rate').quality,'valid');
  assert.equal(rows.find(row=>row.quantity==='co2').quality,'sensor_fault');
  const restored=await parseCsv(deviceCsv(rows, true));
  assert.equal(restored.find(row=>row.quantity==='co2').interval_start_utc,'2026-11-14T07:45:00Z');
  assert.equal(restored.find(row=>row.quantity==='co2').quality,'sensor_fault');
});

test('malformed timestamps, conflicting frames, empty rows and irrelevant fields are rejected', async () => {
  await assert.rejects(parseCsv(minimal.replace('heart_rate','expected_result'),context),/Unknown device column/);
  await assert.rejects(parseCsv(minimal.replace('2026-11-14','2026-02-30'),context),/UTC/);
  await assert.rejects(parseCsv(minimal.replace('120,1200','-1,1200'),context),/value/);
  await assert.rejects(parseCsv(minimal+minimal.split('\n')[1]+'\n',context),/Duplicate timestamp record ID/);
  await assert.rejects(parseCsv(minimal+minimal.split('\n')[1].replace('FRAME-1','FRAME-2')+'\n',context),/Combine measurements/);
  await assert.rejects(parseCsv('record_id,timestamp,heart_rate\nR1,2026-11-14T08:00:00Z,\n',context),/at least one measurement/);
  await assert.rejects(parseCsv(minimal+'bad,row\n',context),/CSV row 3/);
});

test('wide corrections replace the matching columns without resurrecting original values', async () => {
  const original=await parseCsv(minimal,context);
  const state={}; appendDeviceCsv(state,original,'original.csv');
  const corrected=await parseCsv('record_id,timestamp,heart_rate,replaces_id,correction_reason\nFIX-1,2026-11-14T08:00:00Z,75,FRAME-1,Device recalculated\n',context);
  appendDeviceCsv(state,corrected,'fix.csv');
  assert.equal(corrected[0].replaces_id,'FRAME-1.heart_rate');
  assert.equal(appendDeviceCsv(state,original,'again.csv').added,0);
  assert.ok(state._missions.M1.records.some(row=>row.record_id==='FRAME-1.heart_rate'));
  const profile=Object.values(state).find(row=>row.astronautId==='A1');
  assert.equal(profile.records.filter(row=>!row.retired).at(-1).values.pulse,75);
});

test('previous long observation files remain readable', async () => {
  const rows=await parseCsv(await readFile(new URL('data/fixtures/device-observations-legacy.csv', import.meta.url),'utf8'));
  assert.equal(rows.length,93);
  assert.equal((await parseCsv(deviceCsv(rows, true))).length,93);
});


test('primary CSV and standard downloads contain only identity, timestamp and every measurement column', async () => {
  const text=await readFile(new URL('data/testing/astronaut-health-data.csv',import.meta.url),'utf8');
  const headers=text.split(/\r?\n/)[0].split(',');
  assert.deepEqual(headers,['record_id','timestamp',...Object.keys(deviceUnits)]);
  const demoContext = {...context,mission_day:'61',data_kind:'synthetic'};
  const rows=await parseCsv(text,demoContext);
  assert.deepEqual([...new Set(rows.map(row=>row.day))],[55,56,57,58,59,60,61]);
  assert.deepEqual(Object.keys(rows[0].inputRow), headers);
  assert.equal(new Set(rows.map(row=>row.importRow)).size,19);
  assert.equal(rows.length,92);
  assert.equal(new Set(rows.map(row=>row.quantity)).size,25);
  for (const row of rows) assert.equal(row.unit,deviceUnits[row.quantity]);
  const state={};const {target}=appendDeviceCsv(state,rows,'clean.csv');
  assert.equal(sleepFlag(state[target]).current.day,61);
  const result=analyseMission(state._missions.M1,state[target]);
  assert.ok(result.findings.some(row=>row.id.startsWith('mission-cabin-point-')));
  assert.ok(result.findings.some(row=>row.id==='mission-instrument-quality'));
  assert.equal(result.summaries.find(row=>row.label==='Recorded mission total').dose,0);
  const exported=deviceCsv(await fixture());
  assert.deepEqual(exported.split('\n')[0].split(','),headers);
  assert.equal((await parseCsv(exported,demoContext)).length,92);

});

test('UTC day assignment preserves gaps and order independently of row order', async () => {
  const csv='record_id,timestamp,heart_rate\nR3,2026-01-02T00:01:00Z,70\nR1,2025-12-31T23:59:00Z,65';
  const rows=await parseCsv(csv,{...context,mission_day:'3'});
  assert.deepEqual(rows.map(row=>row.day),[3,1]);
  const state={}; const {target}=appendDeviceCsv(state,rows,'days.csv');
  assert.equal(state[target].day,3);
  await assert.rejects(parseCsv(csv,context),/too early/);
  await assert.rejects(parseCsv(csv,{...context, mission_day:'3', astronaut_id:''}),/astronaut ID/);
});


test('comparison samples share measurement coverage, isolate profiles and produce distinct demo outcomes', async () => {
  const state = {};
  const profiles = {};
  let originalCoverage;
  for (const variant of ['data', 'stable', 'worsening']) {
    const filename = 'astronaut-health-' + variant + '.csv';
    const text = await readFile(new URL('data/testing/' + filename, import.meta.url), 'utf8');
    const rows = await parseCsv(text, { ...context, mission_id: 'SAMPLE-' + variant, mission_day: '61', data_kind: 'synthetic' });
    assert.deepEqual(Object.keys(rows[0].inputRow), ['record_id', 'timestamp', ...Object.keys(deviceUnits)]);
    assert.equal(rows.length, 92);
    assert.equal(new Set(rows.map(row => row.importRow)).size, 19);
    assert.deepEqual([...new Set(rows.map(row => row.day))], [55, 56, 57, 58, 59, 60, 61]);
    const coverage = rows.map(row => row.timestamp_utc + '/' + row.quantity);
    if (originalCoverage) assert.deepEqual(coverage, originalCoverage);
    else originalCoverage = coverage;
    const { target } = appendDeviceCsv(state, rows, filename);
    assert.equal(appendDeviceCsv(state, rows, 'renamed.csv').added, 0);
    profiles[variant] = state[target];
    assert.equal(analyseMission(state._missions[state[target].missionId], state[target]).summaries.find(item => item.label === 'Recorded mission total').dose, 0);
  }
  assert.equal(Object.keys(state._missions).length, 3);
  assert.equal(readingFindings(profiles.stable).length, 0);
  assert.equal(analyseMission(state._missions[profiles.stable.missionId], profiles.stable).findings.filter(item => item.healthConcern).length, 0);
  assert.ok(readingFindings(profiles.data).length > 0);
  assert.ok(readingFindings(profiles.worsening).length > readingFindings(profiles.data).length);
  for (const key of ['pulse', 'systolic', 'diastolic', 'temperature', 'glucose']) {
    assert.ok(latest(profiles.worsening.records, key).values[key] > latest(profiles.stable.records, key).values[key], key);
  }
  assert.ok(latest(profiles.worsening.records, 'sleep').values.sleep < latest(profiles.stable.records, 'sleep').values.sleep);
});
