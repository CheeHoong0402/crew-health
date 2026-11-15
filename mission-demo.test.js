import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv } from './csv.js';
import { appendHazardCsv } from './hazard-csv.js';
import { analyseMission, evaluateMission, demoCoverage, missionCsv, separateDemo, scenarioTime, recordMissionAction, handoffSnapshot } from './mission-demo.js';

async function fixture() {
  const rows = await parseCsv(await readFile(new URL('data/testing/five-hazards-synthetic.csv', import.meta.url), 'utf8'));
  const state = {};
  const { target } = appendHazardCsv(state, rows, 'test.csv');
  const profile = state[target], mission = state._missions[profile.missionId];
  mission.evaluationTime = scenarioTime(rows);
  return { rows, state, profile, mission };
}
test('numeric gauges use explicit source rules and never graph missing-data statuses as measurements', async () => {
  const { mission, profile } = await fixture();
  const findings = evaluateMission(mission, profile);
  const cabin = findings.find(item => item.id.startsWith('mission-cabin-') && !item.id.startsWith('mission-cabin-point-') && item.range?.unit === 'ppm');
  assert.equal(cabin.range.high, 5000);
  assert.equal(cabin.range.low, null);
  const samples = mission.records.filter(row => cabin.evidenceIds.includes(row.record_id) && row.quantity === 'co2' && row.record_type === 'measurement');
  assert.equal(cabin.range.value, Math.max(...samples.map(row => +row.value)));
  assert.equal(cabin.range.peak, samples.length > 1);
  mission.records.push({ ...samples[0], record_id: 'EXTRA-CO2', value: String(+samples[0].value + 50) });
  const updated = evaluateMission(mission, profile).find(item => item.id === cabin.id);
  assert.equal(updated.range.value, +samples[0].value + 50);
  assert.ok(updated.range.peak);
  assert.ok(findings.filter(item => item.id.startsWith('mission-freshness-')).every(item => item.range === null));
  const dose = findings.find(item => item.id.startsWith('mission-dose-'));
  assert.equal(dose.range.value, 24);
  assert.equal(dose.range.high, 20);
});

test('attention concerns exclude stale logs, instrument gaps, task reminders and handoff status', async () => {
  const { mission, profile } = await fixture();
  const findings = evaluateMission(mission, profile);
  for (const prefix of ['mission-freshness-', 'mission-task-', 'mission-handoff-']) {
    const items = findings.filter(item => item.id.startsWith(prefix));
    assert.ok(items.length, prefix);
    assert.ok(items.every(item => !item.healthConcern), prefix);
  }
  const instrument = mission.records.find(row => row.quantity === 'personal_dose_equivalent' && row.record_type === 'measurement');
  instrument.calibration_status = 'unverified';
  const recalculated = evaluateMission(mission, profile);
  const verification = recalculated.find(item => item.id === 'mission-instrument-quality');
  assert.ok(verification);
  assert.equal(verification.healthConcern, false);
  assert.ok(recalculated.filter(item => item.id.startsWith('mission-coverage-')).every(item => !item.healthConcern));
  for (const prefix of ['mission-case-', 'mission-sleep-', 'mission-support-', 'mission-gravity-', 'mission-cabin-']) {
    const items = findings.filter(item => item.id.startsWith(prefix));
    assert.ok(items.length && items.every(item => item.healthConcern), prefix);
  }
});
test('manual editor CSV and uploaded CSV preserve every source field and complete coverage', async () => {
  const {rows} = await fixture();
  const roundtrip = await parseCsv(missionCsv(rows));
  const namespace = await parseCsv(missionCsv(separateDemo(roundtrip, 'independent')));
  const state = {};
  const {target} = appendHazardCsv(state, namespace, 'manual.csv');
  assert.equal(namespace.length, 142);
  assert.ok(demoCoverage(namespace, 'A-07').every(item => item.complete));
  assert.equal(demoCoverage(namespace, 'A-07').length, 17);
  assert.ok(demoCoverage(namespace, 'A-08').some(item => !item.complete));
  assert.notEqual(state[target].missionId, rows[0].mission_id);
  assert.equal(namespace[0].text, rows[0].text);
});

test('incident findings identify the reported problem and preserve review state across actions', async () => {
  const { mission, profile } = await fixture();
  const incident = mission.records.find(row => row.record_type === 'incident' && row.astronaut_id === profile.astronautId);
  let finding = evaluateMission(mission, profile).find(row => row.taskId === incident.record_id);
  assert.equal(finding.label, incident.text.trim());
  assert.equal(finding.value, 'Crew review required');
  assert.equal(finding.urgent, incident.status === 'open');
  recordMissionAction(mission, finding, 'Demo review recorded', 'A-08', '', mission.evaluationTime);
  finding = evaluateMission(mission, profile).find(row => row.id === finding.id);
  assert.equal(finding.value, 'Action recorded; follow-up remains open');
  incident.text = '';
  assert.equal(evaluateMission(mission, profile).find(row => row.id === finding.id).label, 'Onboard case requires crew review');
});

test('radiation reproduces coverage arithmetic and excludes overlapping or faulty doses', async () => {
  const {mission,profile} = await fixture();
  let result = analyseMission(mission,profile);
  assert.equal(result.summaries[0].dose,24);
  assert.equal(result.summaries[0].missingMinutes,0);
  assert.equal(result.summaries.find(row => row.label === 'Recorded mission total').dose,25);
  assert.ok(result.findings.some(item=>item.id.startsWith('mission-rate-') && item.value===6));
  const partial = structuredClone(mission);
  partial.records = partial.records.filter(row=>row.record_id!=='RAD-GAP-FILL');
  result=analyseMission(partial,profile);
  assert.equal(result.summaries[0].dose,16);
  assert.equal(result.summaries[0].missingMinutes,80);
  assert.ok(result.findings.some(item=>item.id.startsWith('mission-coverage-')));
  const overlap=structuredClone(mission);
  const fill=overlap.records.find(row=>row.record_id==='RAD-GAP-FILL');
  overlap.records.push({...fill,record_id:'OVERLAP'});
  assert.equal(analyseMission(overlap,profile).summaries[0].dose,16);
  fill.quality='sensor_fault';
  assert.equal(analyseMission(overlap,profile).summaries[0].dose,24);
});

test('sleep opportunity changes the action, and support remains independent of mood', async () => {
  const {mission,profile}=await fixture();
  assert.ok(evaluateMission(mission,profile).some(item=>item.label==='Review interrupted sleep'));
  mission.records.find(row=>row.record_id==='WELL-61-OPPORTUNITY').value='5';
  const findings=evaluateMission(mission,profile);
  assert.ok(findings.some(item=>item.label==='Review available rest time'));
  assert.ok(findings.some(item=>item.id.startsWith('mission-support-')));
  const support=findings.find(item=>item.id.startsWith('mission-support-'));
  recordMissionAction(mission,support,'Crew check-in completed','A-08','',mission.evaluationTime,true);
  assert.ok(!evaluateMission(mission,profile).some(item=>item.id===support.id));
});

test('gravity correction changes onset interval and retains the assigned deadline', async () => {
  const {mission,profile}=await fixture();
  let finding=evaluateMission(mission,profile).find(item=>item.id.startsWith('mission-gravity-'));
  assert.equal(finding.value,'10 minutes after transition');
  assert.ok(finding.detail.includes('09:45'));
  mission.records=mission.records.filter(row=>row.record_id!=='LANDING-CORRECTION');
  finding=evaluateMission(mission,profile).find(item=>item.id.startsWith('mission-gravity-'));
  assert.equal(finding.value,'20 minutes after transition');
  assert.ok(finding.detail.includes('09:45'));
});

test('shared cabin episodes match compartment and time, reject faults and mark stale data', async () => {
  const {mission,state,profile}=await fixture();
  const first=evaluateMission(mission,profile);
  const co2=first.find(item=>item.id.startsWith('mission-cabin-') && item.unit==='ppm');
  assert.ok(co2.evidenceIds.includes('HEADACHE-01'));
  assert.ok(!co2.evidenceIds.includes('HEADACHE-OTHER'));
  assert.ok(!co2.evidenceIds.includes('CABIN-CO2-FAULT'));
  assert.equal(first.filter(item=>item.id.startsWith('mission-freshness-')).length,3);
  const other=Object.values(state).find(item=>item.astronautId==='A-08');
  assert.equal(evaluateMission(mission,other).find(item=>item.id===co2.id).id,co2.id);
  mission.evaluationTime='2026-12-03T10:25:00Z';
  assert.equal(evaluateMission(mission,profile).filter(item=>item.id.startsWith('mission-freshness-')).length,0);
});

test('local procedures, actions, deadlines and selective handoff survive serialization', async () => {
  const {mission,profile}=await fixture();
  const task=evaluateMission(mission,profile).find(item=>item.taskId==='CASE-CHECK');
  assert.ok(task.procedure.text);
  recordMissionAction(mission,task,'Repeat assigned','A-08','2026-12-03T14:35:00Z',mission.evaluationTime);
  assert.throws(()=>recordMissionAction(mission,task,'','A-08','',mission.evaluationTime));
  assert.throws(()=>recordMissionAction(mission,task,'Repeat','A-08','2026-12-03T14:00:00Z',mission.evaluationTime));
  const restored=JSON.parse(JSON.stringify(mission));
  assert.equal(restored.actions[task.id].actions[0].note,'Repeat assigned');
  assert.ok(evaluateMission(restored,profile).some(item=>item.taskId==='assigned-0'));
  recordMissionAction(restored,task,'Repeat completed, stable response','A-08','',restored.evaluationTime,true);
  assert.ok(!evaluateMission(restored,profile).some(item=>item.taskId==='CASE-CHECK'));
  const snapshot=handoffSnapshot(restored,'A-07',['CASE-01'],'What is the next assessment?',restored.evaluationTime);
  assert.equal(snapshot.delivery,'unconfirmed');
  assert.equal(snapshot.records.length,1);
  assert.throws(()=>handoffSnapshot(restored,'A-07',['SUPPORT-01'],'Question',restored.evaluationTime),/Private/);
});


test('complete example fills seven days of device trends and scopes private follow-ups', async () => {
  const {mission, profile, state} = await fixture();
  for (const quantity of ['heart_rate', 'systolic_pressure', 'diastolic_pressure', 'body_temperature', 'blood_glucose', 'sleep_hours', 'sleep_opportunity_hours', 'mood', 'fluid_intake', 'urine_specific_gravity', 'oxygen_saturation', 'respiratory_rate']) {
    for (let day = 55; day <= 61; day++) assert.ok(mission.records.some(row => row.astronaut_id === 'A-07' && +row.mission_day === day && row.quantity === quantity), quantity + ' day ' + day);
  }
  const support = evaluateMission(mission, profile).find(row => row.id.startsWith('mission-support-'));
  recordMissionAction(mission, support, 'Private synthetic follow-up', 'A-08', '2026-12-03T14:40:00Z', mission.evaluationTime);
  assert.equal(mission.actions[support.id].restricted, true);
  const followup = evaluateMission(mission, profile).find(row => row.taskId === 'assigned-0');
  assert.equal(followup.restricted, true);
  const other = Object.values(state).find(item => item.astronautId === 'A-08');
  assert.ok(!evaluateMission(mission, other).some(row => row.taskId === 'assigned-0'));
  recordMissionAction(mission, followup, 'Completed privately', 'A-08', '', mission.evaluationTime, true);
  assert.ok(!evaluateMission(mission, profile).some(row => row.taskId === 'assigned-0'));
});


test('faults break counter continuity and strict demo limits do not trigger at equality', async () => {
  const {mission,profile} = await fixture();
  const faulty = structuredClone(mission);
  faulty.records.find(row => row.record_id === 'RAD-112').quality = 'sensor_fault';
  assert.equal(analyseMission(faulty, profile).summaries[0].dose, 8);
  assert.equal(analyseMission(faulty, profile).summaries[0].missingMinutes, 40);
  mission.records.find(row => row.record_id === 'RAD-GAP-FILL').value = '4';
  mission.records.find(row => row.record_id === 'RAD-RATE').value = '5';
  for (const row of mission.records.filter(row => row.record_type === 'measurement' && row.quantity === 'co2')) row.value = '5000';
  const findings = evaluateMission(mission,profile);
  assert.ok(!findings.some(row => row.id.startsWith('mission-dose-') || row.id.startsWith('mission-rate-')));
  assert.ok(!findings.some(row => row.id.startsWith('mission-cabin-') && row.unit === 'ppm'));
  const wrong = structuredClone(mission.records);
  wrong.find(row => row.record_id === 'RAD-RATE').reading_type = 'cumulative_counter';
  await assert.rejects(parseCsv(missionCsv(wrong)), /Dose rate needs/);
});
