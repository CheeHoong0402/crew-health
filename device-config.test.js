import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { procedureForConcern, guidanceQuestion } from './device-config.js';
import { systems } from './model.js';

test('every body system opens a named local procedure, with private support handled separately', () => {
  for (const { id } of systems) {
    const procedure = procedureForConcern({ system: id });
    assert.notEqual(procedure.title, 'Review the reported concern', id);
    assert.equal(procedure.steps.length, 3);
    assert.equal(procedure.version, 'demo-local-v2');
  }
  assert.equal(procedureForConcern({ system: 'lungs' }).title, 'Respond to the breathing concern');
  assert.equal(procedureForConcern({ id: 'mission-support-01', system: 'sleep' }).title, 'Complete the crew check-in');
  assert.equal(procedureForConcern({ system: 'unknown' }).title, 'Review the reported concern');
});

test('opening a procedure shows local steps and recovers when automatic AETHER lookup fails', async () => {
  const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function showConcernProcedure('), source.indexOf('function eventDialog('));
  const panel = { innerHTML: 'PROC-CASE', isConnected: true, append: () => {} };
  const evidence = [];
  const context = {
    procedureForConcern, guidanceQuestion, AbortSignal, fetch: async () => { throw Error('offline'); },
    escape: text => String(text).replaceAll('<', '&lt;'),
    $: selector => selector === '#dialog-body .guidance' ? panel : { append: node => evidence.push(node) },
    document: { createElement: () => ({ setAttribute() {} }) }
  };
  await vm.runInNewContext(code + "\nshowConcernProcedure({system:'sleep'});", context);
  assert.match(panel.innerHTML, /Review sleep and rest/);
  assert.equal((panel.innerHTML.match(/<li>/g) || []).length, 3);
  assert.doesNotMatch(panel.innerHTML, /PROC-CASE|Find guidance|Search/);
  assert.match(evidence[0].textContent, /demo-local-v2/);
  assert.doesNotMatch(source, /bindGuidanceSearch|Search with AETHER|Find guidance/);
});

test('automatic questions preserve supplied units and exclude private support text', () => {
  const question = guidanceQuestion({ label: 'Cabin reading', range: { value: 6500, unit: 'ppm' } });
  assert.match(question, /CO2 6500 ppm/);
  assert.equal(question, 'Cabin CO2 6500 ppm');
  assert.equal(guidanceQuestion({ system: 'sleep', range: { value: 5, unit: 'h' } }), 'Slept 5 hours');
  assert.equal(guidanceQuestion({ label: 'Breathing concern', value: 'Crew review required' }), 'Breathing concern');
  assert.doesNotMatch(question, /mmHg/);
  assert.doesNotMatch(guidanceQuestion({ restricted: true, label: 'PRIVATE NOTE', value: 'PRIVATE VALUE' }), /PRIVATE/);
});

test('model suggestions render escaped steps and provenance, while weak or stale results retain local guidance', async () => {
  const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function loadAetherProcedure('), source.indexOf('function eventDialog('));
  const result = { protocol_id: 'PROTO-MIND-01', matched_protocol: 'Sleep review', confidence: 0.8,
    severity: 'CAUTION_AMBER', crew_actions: ['<script>unsafe</script>'], guidance_version: 'test-model' };
  const panel = { innerHTML: 'local steps', isConnected: true, closest: () => ({ open: true }), append() {} };
  const status = {}, evidence = { textContent: 'Local version.' };
  const context = { guidanceQuestion, AbortSignal, escape: text => String(text).replaceAll('<', '&lt;'),
    document: { createElement: () => ({}) }, fetch: async () => ({ ok: true, json: async () => result }) };
  vm.createContext(context);
  vm.runInContext(code, context);
  await context.loadAetherProcedure({ system: 'sleep', record: { id: 'source-1' } }, panel, status, evidence);
  assert.match(panel.innerHTML, /AETHER suggestion/);
  assert.doesNotMatch(panel.innerHTML, /<script>/);
  assert.equal(panel.suggestion.version, 'test-model');
  assert.equal(panel.suggestion.sourceIds[0], 'source-1');
  result.confidence = 0.1;
  panel.innerHTML = 'local steps';
  await context.loadAetherProcedure({ system: 'sleep' }, panel, status, evidence);
  assert.equal(panel.innerHTML, 'local steps');
  assert.match(status.textContent, /confidently/);
  result.confidence = 0.9;
  panel.isConnected = false;
  await context.loadAetherProcedure({ system: 'sleep' }, panel, status, evidence);
  assert.equal(panel.innerHTML, 'local steps');
});
