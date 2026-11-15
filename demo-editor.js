import { deviceCsv, appendDeviceCsv } from './device-csv.js';
import { hazardColumns, appendHazardCsv } from './hazard-csv.js';
import { parseCsv } from './csv.js';
import { missionCsv, demoCoverage } from './mission-demo.js';

let draft;
let loading;
let section = 'Measurements';
let selectedIndex = 0;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function category(row) {
  if (['astronaut', 'compartment', 'expectation'].includes(row.record_type)) return 'Mission setup';
  if (['demo_procedure', 'demo_rule'].includes(row.record_type)) return 'Rules & procedures';
  if (row.record_type === 'device_assignment') return 'Devices';
  if (row.record_type === 'wellbeing') return 'Sleep & mood';
  if (['assessment_result', 'lab_result'].includes(row.record_type)) return 'Exams & lab results';
  if (['symptom', 'incident', 'gravity_transition', 'spacewalk'].includes(row.record_type)) return 'Symptoms & events';
  if (row.record_type === 'exercise') return 'Exercise';
  if (['support_request', 'task', 'assessment_task', 'crew_action', 'handoff', 'handoff_reply'].includes(row.record_type)) return 'Tasks & communication';
  return 'Measurements';
}
const primary = ['record_id', 'record_type', 'astronaut_id', 'compartment_id', 'quantity', 'value', 'unit', 'timestamp_utc', 'interval_start_utc', 'interval_end_utc', 'posture', 'activity', 'from_environment', 'to_environment', 'owner_id', 'recipient_id', 'due_at_utc', 'status', 'text'];
function input(row, key) {
  const value = row[key];
  const label = key.replaceAll('_', ' ');
  if (['text', 'expected_result', 'correction_reason'].includes(key)) return '<label>' + label + '<textarea data-field="' + key + '" maxlength="4000">' + escape(value) + '</textarea></label>';
  return '<label>' + label + '<input data-field="' + key + '" value="' + escape(value) + '"' + (key === 'data_kind' ? ' readonly' : '') + '><small>' + (key.endsWith('_utc') ? 'UTC, e.g. 2026-12-03T08:00:00Z' : '') + '</small></label>';
}
function coverageHtml() {
  const who = draft.find(row => row.record_type === 'astronaut')?.record_id;
  const checks = demoCoverage(draft, who);
  const complete = checks.filter(item => item.complete).length;
  return '<details class="coverage-checklist"><summary>' + complete + '/' + checks.length + ' required areas covered for ' + escape(who || 'crew') + '</summary><ul>' + checks.map(item => '<li>' + (item.complete ? '✓ ' : 'Missing · ') + escape(item.label) + '</li>').join('') + '</ul></details>';
}
export async function mountDemoEditor(root, onSave) {
  try {
    if (!draft) {
      loading ||= fetch('data/fixtures/five-hazards-synthetic.csv').then(response => {
        if (!response.ok) throw Error('Could not load the complete example. Retry while the app server is running.');
        return response.text();
      }).then(parseCsv).catch(error => { loading = null; throw error; });
      draft = structuredClone(await loading);
    }
    if (!root.isConnected) return;
    function renderEditor() {
      const groups = [...new Set(draft.map(category))];
      const entries = draft.map((row, index) => ({ row, index })).filter(item => category(item.row) === section);
      if (!entries.some(item => item.index === selectedIndex)) selectedIndex = entries[0]?.index ?? 0;
      const row = draft[selectedIndex];
      const visible = primary.filter(key => row[key] !== '' || key === 'text');
      root.innerHTML = '<div class="editor-toolbar"><label>Record type<select id="demo-section">' + groups.map(name => '<option ' + (name === section ? 'selected' : '') + '>' + name + '</option>').join('') + '</select></label><label>Record<select id="demo-record">' + entries.map(item => '<option value="' + item.index + '" ' + (item.index === selectedIndex ? 'selected' : '') + '>' + escape(item.row.record_id + ' · ' + (item.row.quantity || item.row.record_type)) + '</option>').join('') + '</select></label></div><div id="draft-coverage">' + coverageHtml() + '</div><form id="demo-data-form"><div class="form-grid">' + visible.map(key => input(row, key)).join('') + '</div><details><summary>All source fields & links</summary><div class="form-grid">' + hazardColumns.filter(key => !visible.includes(key)).map(key => input(row, key)).join('') + '</div></details><p class="form-error" role="alert"></p><div class="input-actions"><button type="button" id="export-draft">Download device CSV</button><button type="submit" class="primary">Save as new demo dataset</button></div></form>';
      root.querySelector('#demo-section').onchange = event => { section = event.target.value; renderEditor(); };
      root.querySelector('#demo-record').onchange = event => { selectedIndex = +event.target.value; renderEditor(); };
      root.querySelectorAll('[data-field]').forEach(field => field.oninput = () => {
        draft[selectedIndex][field.dataset.field] = field.value;
        root.querySelector('#draft-coverage').innerHTML = coverageHtml();
      });
      async function validate() {
        const parsed = await parseCsv(missionCsv(draft));
        appendHazardCsv({}, parsed, 'manual-demo.csv');
        const who = parsed.find(item => item.record_type === 'astronaut')?.record_id;
        const missing = demoCoverage(parsed, who).filter(item => !item.complete);
        if (missing.length) throw Error('Complete these areas before publishing the demo: ' + missing.map(item => item.label).join(', '));
        return parsed;
      }
      root.querySelector('#export-draft').onclick = async () => {
        try {
          const astronaut = draft.find(row => row.record_type === 'astronaut');
          const compartment = draft.find(row => row.record_type === 'compartment');
          const observations = await parseCsv(deviceCsv(draft), { mission_id: astronaut.mission_id, astronaut_id: astronaut.record_id, mission_day: astronaut.mission_day, data_kind: 'synthetic', compartment_id: compartment?.record_id || '' });
          appendDeviceCsv({}, observations, 'manual-device-export.csv');
          const url = URL.createObjectURL(new Blob([deviceCsv(draft)], { type: 'text/csv;charset=utf-8' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = 'astronaut-health-data.csv';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { root.querySelector('.form-error').textContent = error.message; }
      };
      root.querySelector('#demo-data-form').onsubmit = async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('[type=submit]');
        button.disabled = true;
        try { await onSave(await validate()); }
        catch (error) { if (root.isConnected) root.querySelector('.form-error').textContent = error.message; }
        finally { button.disabled = false; }
      };
    }
    renderEditor();
  } catch (error) {
    if (root.isConnected) {
      root.textContent = error.message;
      const retry = document.createElement('button');
      retry.textContent = 'Retry loading example';
      retry.onclick = () => mountDemoEditor(root, onSave);
      root.append(retry);
    }
  }
}
