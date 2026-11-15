import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { systems } from './model.js';

const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
test('body marker popup reuses only matching health cards and retains procedure actions', () => {
  const findings = [
    {id: 'head-health', system: 'head', label: 'Headache', value: 'Review'},
    {id: 'head-task', system: 'head', missionFinding: true, healthConcern: false},
    {id: 'heart-health', system: 'heart', label: 'Pulse', value: 'Review'}
  ];
  const context = vm.createContext({
    allFindings: () => findings,
    visibleEvents: (_, id) => id === 'head' ? [{id: 'report-1', text: 'Dizziness'}] : [],
    findingGauge: () => '', escape: String
  });
  vm.runInContext(source.slice(source.indexOf('function findingCard('), source.indexOf('function bodyMarkers(')), context);
  vm.runInContext(source.slice(source.indexOf('function attention('), source.indexOf('function importedMissionRows(')), context);
  const html = vm.runInContext('attention({}, "head")', context);
  assert.match(html, /Headache/);
  assert.match(html, /Dizziness/);
  assert.match(html, /data-finding="head-health"/);
  assert.match(html, /data-event="report-1"/);
  assert.doesNotMatch(html, /head-task|heart-health|data-locate|tabindex/);
});
test('every system selection has a decorative line icon', () => {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function uiIcon('), source.indexOf('function missionFor(')), context);
  for (const system of systems) {
    const html = context.uiIcon(system.id);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /<path/);
    assert.doesNotMatch(html, /undefined/);
  }
});
