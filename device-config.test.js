import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { procedureForConcern } from './device-config.js';
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

test('opening a procedure replaces the generic block with numbered steps without a search or network request', () => {
  const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function showConcernProcedure('), source.indexOf('function eventDialog('));
  const panel = { innerHTML: 'PROC-CASE' };
  const evidence = [];
  const context = {
    procedureForConcern, escape: text => String(text).replaceAll('<', '&lt;'),
    $: selector => selector === '#dialog-body .guidance' ? panel : { append: node => evidence.push(node) },
    document: { createElement: () => ({}) }
  };
  vm.runInNewContext(code + "\nshowConcernProcedure({system:'sleep'});", context);
  assert.match(panel.innerHTML, /Review sleep and rest/);
  assert.equal((panel.innerHTML.match(/<li>/g) || []).length, 3);
  assert.doesNotMatch(panel.innerHTML, /PROC-CASE|Find guidance|Search/);
  assert.match(evidence[0].textContent, /demo-local-v2/);
  assert.doesNotMatch(source, /bindGuidanceSearch|Search with AETHER|Find guidance/);
});
