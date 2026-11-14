import './assets/model-viewer.min.js';
customElements.get('model-viewer').meshoptDecoderLocation = new URL('./assets/meshopt_decoder.js', import.meta.url).href;
import { metrics, systems, sources, freshProfile, latest, currentRecords, sleepFlag, validateRecord, validatePersonal, updateEvent, openRegionEvents, readingFindings, demoRules, addObservation, reviewFinding } from './model.js';
import { parseCsv, appendCsv, csvTestProfile, csvLimit } from './csv.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const utc = value => new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const nowInput = () => new Date().toISOString().slice(0, 16);
let state = { demo: freshProfile(true), manual: freshProfile(false) };
let profileKey = localStorage.getItem('crew-health-profile') || 'demo';
let page = location.hash === '#profile' ? 'profile' : 'dashboard';
let selected = 'heart';
let back = false;
const defaultLayers = [
  { id: 'skin', label: 'Skin', opacity: 12 },
  { id: 'muscles', label: 'Muscles', opacity: 24 },
  { id: 'skeleton', label: 'Bones', opacity: 100 },
  { id: 'organs', label: 'Organs', opacity: 100 },
  { id: 'vessels', label: 'Blood vessels', opacity: 100 },
  { id: 'nerves', label: 'Nerves', opacity: 100 }
].map(layer => ({ ...layer, visible: true }));
const layers = structuredClone(defaultLayers);

// Reference locations on the standing model, expressed in metres.
const regionPositions = {
  heart: '0.04m 1.25m 0.08m', lungs: '-0.08m 1.3m 0.08m',
  abdomen: '0m 1.04m 0.08m', kidneys: '0.07m 1.09m -0.055m',
  eyes: '0.03m 1.62m 0.075m', head: '0m 1.67m 0.05m',
  spine: '0m 1.12m -0.06m', limbs: '0.11m 0.59m 0.03m',
  sleep: '0m 1.72m 0.05m',
  skin: '-0.24m 1.12m 0.03m'
};
let db;
let busy = false;
let storageReady = false;
const profile = () => state[profileKey];

function toast(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').className = error ? 'notice error' : 'notice';
}
async function commit(next) {
  if (!storageReady) throw Error('Local storage is unavailable. Reload with browser storage enabled.');
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readwrite');
    const store = transaction.objectStore('state');
    const request = store.get('profiles');
    let conflict = false;
    request.onsuccess = () => {
      if ((request.result?._revision || 0) !== (state._revision || 0)) {
        conflict = true;
        transaction.abort();
        return;
      }
      next._revision = (state._revision || 0) + 1;
      store.put(next, 'profiles');
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(conflict ? Error('Another tab saved newer data. Reload before saving this change.') : transaction.error || Error('Save interrupted.'));
  });
  state = next;
  localStorage.setItem('crew-health-profile', profileKey);
}
async function changeProfile(edit) {
  if (busy) throw Error('A save is in progress. Please try again.');
  busy = true;
  try {
    const next = structuredClone(state);
    edit(next[profileKey]);
    await commit(next);
  } finally { busy = false; }
}
function modal(title, body, onSubmit) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = body;
  const form = $('#dialog-body form');
  if (form && onSubmit) form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try { await onSubmit(new FormData(form)); $('#dialog').close(); render(); }
    catch (error) { form.querySelector('.form-error').textContent = error.message || 'Could not save. Please try again.'; }
    finally { button.disabled = false; }
  };
  $('#dialog').showModal();
}
const formEnd = (label = 'Save onboard') => '<p class="form-error" role="alert"></p><button class="primary" type="submit">' + label + '</button></form>';
function valueOf(data, key) {
  const record = latest(data?.records || [], key);
  return record ? escape(record.values[key]) + ' <small>' + (metrics[key]?.unit || '') + '</small>' : '<span class="muted">' + (key === 'glucose' ? 'Not scheduled' : 'No reading') + '</span>';
}
function render() {
  document.querySelectorAll('[data-page]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.page === page)));
  const data = profile();
  $('#main').innerHTML = `
    <section class="mission-bar">
      <div><h1>${page === 'dashboard' ? 'Health dashboard' : 'Astronaut profile & data'}</h1><p>${escape(data.personal?.name || 'Crew member')} ${escape(data.personal?.astronautId || 'A-07')} <span class="separator">/</span> Day ${data?.day ?? profile().day} <span class="separator">/</span> ${escape(data?.phase ?? profile().phase)}</p></div>
      <div class="mission-controls"><label class="small">Profile <select id="profile">${Object.entries(state).filter(([, data]) => Array.isArray(data?.records)).map(([key, data]) => '<option value="' + key + '" ' + (key === profileKey ? 'selected' : '') + '>' + escape(data.label || (key === 'demo' ? 'Simulated mission' : 'Manual entries')) + '</option>').join('')}</select></label><span class="connection"><i></i>${navigator.onLine ? 'Local workspace' : 'Offline'}</span><span class="small muted">${storageReady ? 'Stored on this device' : 'Storage unavailable'}</span></div>
    </section>
    <div class="workspace-note"><span>${escape(data.label || (profileKey === 'demo' ? 'Simulated mission data' : 'Manual entries'))} · ${data.records.length} recorded entries</span>${page === 'dashboard' ? '<button id="open-data">Manage astronaut & data</button>' : ''}</div>
    ${page === 'dashboard' ? dashboard(data) : personalPage(data)}
  `;
  bindDashboard();
}

function systemContext(id) {
  if (id === 'exposure') return '<h3>Space radiation</h3><p>Personal dosimetry and spacewalk intervals are required. Dose coverage is unavailable.</p>';
  if (id === 'operations') return '<h3>Hostile / closed environment</h3><p>Cabin CO₂, pressure, temperature and compartment logs are unavailable.</p><h3>Distance from Earth</h3><p>Records and crew actions save locally for offline review. Ground receipt is unconfirmed.</p>';
  if (id === 'sleep') return '<h3>Isolation & confinement</h3><p>Review sleep, mood and shift context together. Record a support request even with no measurements.</p>';
  if (['spine', 'limbs', 'head', 'eyes', 'heart', 'kidneys'].includes(id)) return '<h3>Gravity fields</h3><p>Interpret observations with activity, posture and mission phase. Gravity-transition records and specialized exams are unavailable.</p>';
  return '<h3>Hostile / closed environment</h3><p>Review symptoms alongside cabin conditions and nutrition context. Habitat and laboratory evidence require separate records.</p>';
}

function findingCard(finding) {
  const record = finding.record;
  return `<article class="alert watch reading-finding"><span class="status-label">${finding.review ? 'Reviewed · Reading still outside demo reference' : '△ Reading review'}</span><h3>${escape(finding.label)}</h3><p class="finding-value">${escape(finding.value)} <small>${metrics[finding.key]?.unit || ''}</small></p><p class="small">Demo reference · ${escape(finding.reference)}</p><p class="small muted">${utc(record.time)} · Day ${record.day}<br>${escape(record.source)}${record.importFile ? ' · ' + escape(record.importFile) + ' · Row ' + record.importRow : ''}<br>${finding.rule} · Source ID ${escape(record.id)}<br>Saved / imported ${record.importedAt || record.recordedAt ? utc(record.importedAt || record.recordedAt) : 'time unavailable for legacy record'}</p><p class="owner">Crew medical officer · Review requested</p><button data-system="${finding.system}" class="subtle wide">Locate on body & inspect</button><button data-finding="${finding.id}" class="wide">Review evidence & record action</button></article>`;
}

function bodyMarkers(data) {
  return systems.filter(system => regionPositions[system.id]).map(system => {
    const events = [...openRegionEvents(data, system.id), ...readingFindings(data).filter(item => item.system === system.id)];
    const urgent = events.some(event => event.urgent);
    const severity = urgent ? 'Urgent' : 'Review';
    if (!events.length) return '';
    const label = severity + ' · ' + system.label + ' (' + events.length + ')';
    return '<button slot="hotspot-' + system.id + '" class="bone-marker ' + (events.length ? (urgent ? 'pin-urgent' : 'pin-review') : '') + '" data-position="' + regionPositions[system.id] + '" data-system="' + system.id + '" aria-label="' + label + '">' + label + '</button>';
  }).join('');
}

function dashboard(data) {
  const system = systems.find(item => item.id === selected);
  return `
    <section class="review-strip"><div><strong>${readingFindings(data).filter(item => !item.review).length} readings to review</strong><span>Latest available observations · Demo rules v1</span><details class="rule-reference"><summary>View alert thresholds</summary><p>Fictional demo references, inclusive boundaries. Outside these ranges prompts review.</p><ul>${Object.entries(demoRules).map(([key, rule]) => '<li>' + (metrics[key]?.label || 'Mood') + ' · ' + (key === 'mood' ? 'Low or Very low' : (key === 'sleep' ? (data.baseline?.low ?? rule.low) + '–' + (data.baseline?.high ?? rule.high) : rule.low + '–' + rule.high) + ' ' + metrics[key].unit) + '</li>').join('')}</ul></details></div><button id="quick-checkin" class="primary">＋ Record check-in</button></section>
    <div class="dashboard">
      <section class="panel attention"><div class="panel-heading"><h2>Attention queue</h2><span class="small muted">Action & evidence</span></div>${attention(data)}</section>
      <section class="panel anatomy"><div class="panel-heading"><h2>Body systems</h2><button id="flip" class="subtle">${back ? 'Back' : 'Front'} ⇄</button></div>
        <div class="skeleton-stage">
          <details class="layer-settings"><summary>Visible layers & opacity</summary>
            <fieldset><legend>Body layers</legend>${layers.map(layer => `<div class="layer-row"><label><input type="checkbox" data-layer="${layer.id}" ${layer.visible ? 'checked' : ''}> ${layer.label}</label><input type="range" min="1" max="100" value="${layer.opacity}" data-opacity="${layer.id}" aria-label="${layer.label} opacity" ${layer.visible ? '' : 'disabled'}><output>${layer.opacity}%</output></div>`).join('')}</fieldset><button id="reset-layers" class="subtle wide" type="button">Reset to default</button>
          </details>
          <model-viewer id="body-model" src="assets/anatomy.glb" alt="Interactive layered human anatomy. Drag to rotate, pinch or scroll to zoom. Use the system list for health evidence."
            camera-controls touch-action="pan-y" camera-orbit="${back ? '180' : '0'}deg 90deg 105%" min-camera-orbit="auto 15deg 40%" max-camera-orbit="auto 165deg 180%" shadow-intensity="0.5" exposure="1.2" interaction-prompt="none" disable-pan>
            ${bodyMarkers(data)}
          </model-viewer>
          <p id="model-status" class="visually-hidden" role="status">Loading 3D anatomy…</p>
          <p class="small muted">Drag to rotate · Scroll or pinch to zoom</p>
        </div>
      </section>
      <section class="panel evidence"><details class="system-menu"><summary><span>Review body system</span><strong>${system.label}</strong></summary><div class="system-list" aria-label="Body system selection">${systems.map(item => '<button data-system="' + item.id + '" aria-pressed="' + (item.id === selected) + '">' + item.label + '</button>').join('')}</div></details><div class="panel-heading"><h2>${system.label}</h2><span class="selected-dot" aria-hidden="true"></span></div>
        <div class="evidence-body">${readingFindings(data).filter(item => item.system === selected).map(finding => '<div class="system-finding"><strong>' + escape(finding.value) + ' ' + (metrics[finding.key]?.unit || '') + ' · Review</strong><p>' + escape(finding.label) + '</p><button data-finding="' + finding.id + '">Evidence & action</button></div>').join('')}${openRegionEvents(data, system.id).map(event => `<div class="region-event"><strong>${event.urgent ? 'Urgent' : 'Review'} · ${escape(event.text)}</strong><p>${utc(event.time)} · Crew report</p><button data-event="${escape(event.id)}">Open event & record action</button></div>`).join('')}${system.keys.length ? system.keys.map(key => { const record = latest(data.records, key); return '<div class="reading"><span>' + (metrics[key]?.label || 'Mood') + '</span><strong>' + valueOf(data, key) + '</strong></div>' + (record ? '<p class="small muted provenance">' + utc(record.time) + ' · Day ' + record.day + '<br>' + escape(record.source) + ' · ' + escape(record.phase) + (record.importFile ? '<br>File ' + escape(record.importFile) + (record.importRow ? ' · Row ' + record.importRow : '') + (record.importedAt ? '<br>Imported ' + utc(record.importedAt) : '') : '') + '</p>' : ''); }).join('') : '<div class="unavailable">○ No exam on file</div>'}
        <p class="evidence-explanation">${system.evidence}</p>
        <details><summary>Associated research risks</summary><ul>${system.risks.map(risk => '<li>' + risk + '</li>').join('')}</ul><a href="${sources[1][1]}" target="_blank" rel="noreferrer">NASA risk reference ↗</a></details>
        <button id="history" class="wide">View observations & trends</button>
        <button id="report" class="subtle wide">＋ Record symptom or event</button>
        </div>
        <div class="exposure">${systemContext(system.id)}<button data-system="exposure" class="subtle">Radiation evidence</button><button data-system="operations" class="subtle">Habitat & onboard support</button></div>
      </section>
    </div>
    <section class="panel latest"><div class="panel-heading"><h2>Latest check-in</h2><button id="open-data-latest">Open data input</button></div>
      <div class="metric-strip">${['pulse', 'systolic', 'temperature', 'sleep', 'mood', 'glucose'].map(key => '<button class="metric ' + (readingFindings(data).some(finding => finding.key === key || key === 'systolic' && finding.key === 'diastolic') ? 'metric-watch' : '') + '" data-metric="' + key + '"><span>' + (key === 'systolic' ? 'Blood pressure' : metrics[key]?.label || 'Mood') + '</span><strong>' + (key === 'systolic' && latest(data.records, key) ? escape(latest(data.records, key).values.systolic) + '/' + escape(latest(data.records, key).values.diastolic ?? '—') + ' <small>mmHg</small>' : valueOf(data, key)) + '</strong></button>').join('')}</div>
    </section>
    <section class="panel timeline dashboard-history"><div class="panel-heading"><h2>Observation history</h2><span class="small muted">UTC</span></div>${timeline(data)}</section>`;

}
function personalPage(data) {
  const personal = data.personal || {};
  const fields = [
    ['name', 'Full name', 'text', 100],
    ['astronautId', 'Astronaut ID', 'text', 40],
    ['missionName', 'Mission name', 'text', 100],
    ['crewRole', 'Crew role', 'text', 100],
    ['dateOfBirth', 'Date of birth', 'date', null],
    ['heightCm', 'Height (cm)', 'number', null],
    ['weightKg', 'Body mass (kg)', 'number', null]
  ];
  return `<div class="profile-grid">
    <section class="panel"><div class="panel-heading"><h2>Personal information</h2></div>
      <form id="personal-form" class="profile-form"><p class="small muted">Saved with the selected profile on this device. Fill in the details available to you.</p>
        <div class="form-grid">${fields.map(([key, label, type, length]) => '<label>' + label + '<input name="' + key + '" type="' + type + '" value="' + escape(personal[key] ?? '') + '"' + (length ? ' maxlength="' + length + '"' : '') + (type === 'number' ? ' min="0.1" max="1000" step="0.1"' : '') + (type === 'date' ? ' max="' + new Date().toISOString().slice(0, 10) + '"' : '') + '></label>').join('')}</div>
        <label>Blood group<select name="bloodGroup"><option value="">Not recorded</option>${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(group => '<option ' + (group === personal.bloodGroup ? 'selected' : '') + '>' + group + '</option>').join('')}</select></label>
        <p class="form-error" role="alert"></p><button type="submit" class="primary">Save personal information</button>
      </form>
    </section>
    <section class="panel data-input"><div class="panel-heading"><h2>CSV & crew observations</h2></div>
      <div class="evidence-body"><p>Import a health CSV to review recorded observations. Add symptoms and crew actions as they occur. Collection times describe the record’s coverage.</p>
        <button id="import-csv" class="primary wide">Import health CSV</button><button id="checkin" class="wide">＋ Record check-in</button><button id="report" class="subtle wide">＋ Record symptom or event</button>
        <div class="profile-mission"><h3>Mission context</h3><p>Day ${data.day} · ${escape(data.phase)}</p><p class="small muted">${escape(personal.missionName || 'Mission name not recorded')}</p><button id="mission" class="wide">Edit mission day & phase</button></div>
        <div class="profile-mission"><h3>CSV test files</h3><p class="small muted">Seven synthetic days per scenario. Test files open in separate profiles.</p><p><a href="healthy-data.csv" download>Healthy data</a> · <a href="unhealthy-data.csv" download>Unhealthy data</a></p></div>
      </div>
    </section>
  </div><section class="panel dashboard-history"><div class="panel-heading"><h2>Data entries & corrections</h2><span class="small muted">Original records retained</span></div>${timeline(data)}</section>`;
}
async function savePersonal(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    const personal = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
    validatePersonal(personal);
    await changeProfile(data => { data.personal = personal; });
    toast('Personal information saved on this device.');
    render();
  } catch (error) {
    form.querySelector('.form-error').textContent = error.message || 'Could not save. Please try again.';
    button.disabled = false;
  }
}
function attention(data) {
  const events = data.events.filter(event => !event.outcome);
  const flag = sleepFlag(data);
  const sleepTask = data.followups.find(task => task.type === 'sleep' && task.day === data.day);
  return '<div class="attention-content">' + readingFindings(data).map(findingCard).join('') + events.map(event => `<article class="alert ${event.urgent ? 'urgent' : 'watch'}"><span class="status-label">${event.urgent ? '⬣ Act now' : '△ Review'}</span><h3>${escape(event.text)}</h3><p class="small">Crew report · ${utc(event.time)}</p><span class="evidence-tag">Self-reported · Sensor evidence unavailable</span><p class="owner">${escape(event.owner)} · ${event.urgent ? 'Now' : 'Review requested'}</p>${event.acknowledged ? '<p class="small muted">Acknowledged ' + utc(event.acknowledged) + '</p>' : ''}${'<button data-event="' + event.id + '" class="wide">Open event & onboard guidance</button>'}</article>`).join('') +
    (flag && !sleepTask?.outcome ? `<article class="alert watch"><span class="status-label">△ Review</span><h3>Two nights below sleep reference</h3><div class="sleep-comparison"><div>Day ${flag.previous.day}<strong>${flag.previous.values.sleep} <small>h</small></strong></div><div>Day ${flag.current.day}<strong>${flag.current.values.sleep} <small>h</small></strong></div></div><p>Personal preflight reference <strong>${data.baseline.low}–${data.baseline.high} h</strong></p><p class="small muted">Fictional demo rule · Self-reported sleep</p><p class="owner">Astronaut · Due day ${data.day + 1}</p><button id="sleep-followup" class="wide">${sleepTask ? 'Open scheduled follow-up' : 'Review schedule & follow up'}</button></article>` : '') +
    (!events.length && !flag && !readingFindings(data).length ? '<div class="quiet"><h3>No open action flags</h3><p>Review available observations and scheduled follow-ups. Unmeasured systems remain unassessed.</p></div>' : '') +
    data.followups.map(task => '<div class="task"><strong>' + escape(task.title) + '</strong><p class="small">Due day ' + task.due + ' · ' + (task.outcome ? 'Closed · ' + escape(task.outcome) : 'Open') + '</p>' + (!task.outcome ? '<button data-task="' + task.id + '">Record outcome</button>' : '') + '</div>').join('') + '</div>';
}
function timeline(data) {
  const rows = [...data.records.map(record => ({ ...record, title: record.replaces ? 'Corrected observation' : 'Check-in recorded', detail: Object.entries(record.values).map(([key, value]) => (metrics[key]?.label || key) + ' ' + value + ' ' + (metrics[key]?.unit || '')).join(' · ') })), ...data.events.map(event => ({ ...event, title: event.text, detail: event.outcome || 'Crew report · Review outcome pending' })), ...(data.reviews || []).flatMap(review => (review.actions || []).map(action => ({ time: action.time, title: 'Reading review · ' + (review.label || review.findingId), detail: action.note, related: review.sourceId || review.findingId })))].sort((a, b) => b.time.localeCompare(a.time));
  return rows.length ? '<ol class="timeline-list">' + rows.map(row => '<li><time>' + utc(row.time) + '</time><div><strong>' + escape(row.title) + '</strong><p>' + escape(row.detail) + '</p>' + (row.context ? '<p class="small muted">' + escape(row.context) + '</p>' : '') + (row.related ? '<p class="small muted">Linked record ' + escape(row.related) + '</p>' : '') + (row.replaces ? '<p class="small muted">Replaces ' + escape(row.replaces) + ' · ' + escape(row.reason) + '</p>' : '') + (page === 'profile' && row.values && !data.records.some(record => record.replaces === row.id) ? '<button class="subtle" data-correct="' + row.id + '">Correct this entry</button>' : '') + '</div></li>').join('') + '</ol>' : '<p class="empty-copy">No observations recorded. Start with a check-in or symptom report.</p>';
}
function bindDashboard() {
  $('#profile').onchange = event => { profileKey = event.target.value; localStorage.setItem('crew-health-profile', profileKey); selected = 'heart'; render(); };
  if ($('#mission')) $('#mission').onclick = missionSettings;
  if ($('#open-data')) $('#open-data').onclick = () => { location.hash = 'profile'; };
  if ($('#open-data-latest')) $('#open-data-latest').onclick = () => { location.hash = 'profile'; };
  if ($('#personal-form')) $('#personal-form').onsubmit = savePersonal;
  document.querySelectorAll('[data-system]').forEach(button => button.onclick = () => { selected = button.dataset.system; render(); });
  document.querySelectorAll('[data-metric]').forEach(button => button.onclick = () => history(button.dataset.metric));
  document.querySelectorAll('[data-correct]').forEach(button => button.onclick = () => checkin(button.dataset.correct));
  document.querySelectorAll('[data-event]').forEach(button => button.onclick = () => eventDialog(button.dataset.event));
  document.querySelectorAll('[data-task]').forEach(button => button.onclick = () => taskOutcome(button.dataset.task));
  if ($('#flip')) $('#flip').onclick = () => {
    back = !back;
    $('#body-model').setAttribute('camera-orbit', (back ? '180' : '0') + 'deg 90deg 105%');
    $('#flip').textContent = (back ? 'Back' : 'Front') + ' ⇄';
  };
  if ($('#body-model')) {
    const viewer = $('#body-model');
    const applyLayers = () => {
      if (!viewer.model) return;
      for (const layer of layers) {
        const material = viewer.model.materials.find(item => item.name === layer.id);
        const alpha = layer.visible ? layer.opacity / 100 : 0;
        material.setAlphaMode(alpha > 0 && alpha < 1 ? 'BLEND' : 'MASK');
        material.pbrMetallicRoughness.setBaseColorFactor([...material.pbrMetallicRoughness.baseColorFactor.slice(0, 3), alpha]);
      }
      const count = layers.filter(layer => layer.visible).length;
      $('#model-status').textContent = count ? count + ' of 6 layers visible' : 'All layers hidden. Select a layer to show anatomy.';
    };
    for (const layer of layers) {
      const check = document.querySelector('[data-layer="' + layer.id + '"]');
      const slider = document.querySelector('[data-opacity="' + layer.id + '"]');
      check.onchange = () => {
        layer.visible = check.checked;
        slider.disabled = !layer.visible;
        applyLayers();
      };
      slider.oninput = () => {
        layer.opacity = Number(slider.value);
        slider.nextElementSibling.textContent = layer.opacity + '%';
        applyLayers();
      };
    }
    $('#reset-layers').onclick = () => {
      layers.forEach((layer, index) => {
        Object.assign(layer, defaultLayers[index]);
        const checkbox = document.querySelector('[data-layer="' + layer.id + '"]');
        const slider = document.querySelector('[data-opacity="' + layer.id + '"]');
        checkbox.checked = layer.visible;
        slider.disabled = false;
        slider.value = layer.opacity;
        slider.nextElementSibling.textContent = layer.opacity + '%';
      });
      applyLayers();
    };
    viewer.addEventListener('load', applyLayers);
    $('#body-model').addEventListener('error', () => { $('#model-status').className = 'small muted'; $('#model-status').textContent = '3D view unavailable. Use the body system controls below.'; });
  }
  if ($('#quick-checkin')) $('#quick-checkin').onclick = () => checkin();
  document.querySelectorAll('[data-finding]').forEach(button => button.onclick = () => findingDialog(button.dataset.finding));
  if ($('#checkin')) $('#checkin').onclick = () => checkin();
  if ($('#import-csv')) $('#import-csv').onclick = importCsv;
  if ($('#history')) $('#history').onclick = () => history(systems.find(item => item.id === selected).keys[0] || 'pulse');
  if ($('#report')) $('#report').onclick = () => report();
  if ($('#sleep-followup')) $('#sleep-followup').onclick = sleepFollowup;
}
function importCsv() {
  let records = [];
  let filename = '';
  let generation = 0;
  modal('Import check-ins from CSV', `<form>
    <p>Upload comma-separated UTF-8 data, up to 1 MB and 1000 rows. Every row is validated before a single save.</p>
    <p><a href="healthy-data.csv" download>Download healthy test data</a> · <a href="unhealthy-data.csv" download>Download unhealthy test data</a></p>
    <label>CSV file<input id="csv-file" type="file" accept=".csv,text/csv" required></label>
    <label>Destination<select id="csv-destination" name="destination"><option value="current">Append to current profile</option><option value="test">Separate synthetic test profile</option></select></label>
    <p class="small muted">A separate test profile uses the fictional 7–8 h sleep reference. Existing profiles retain their records, open events and reference settings.</p>
    <details><summary>CSV column format</summary><p class="small">Required headers: mission_day, timestamp_utc, phase, data_kind. Optional measurements: heart_rate_bpm, systolic_mmhg, diastolic_mmhg, temperature_c, sleep_hours, mood, glucose_mgdl, context.</p><p class="small">Use UTC timestamps such as 2026-11-14T08:10:00Z. data_kind is synthetic or observed. Leave unavailable readings blank. Both blood pressure values are required when either is recorded.</p></details>
    <div id="csv-preview" aria-live="polite"><p>Select a file to preview its data.</p></div>
    ${formEnd('Import validated rows')}`, async fields => {
    const imported = records;
    const importedName = filename;
    if (!imported.length) throw Error('Select and validate a CSV file first.');
    const separate = fields.get('destination') === 'test';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(imported.map(record => record.id).sort().join(',')));
    const testKey = 'csv-' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const target = separate ? testKey : profileKey;
    if (busy) throw Error('A save is in progress. Please try again.');
    busy = true;
    let added;
    try {
      const next = structuredClone(state);
      if (separate && !next[target]) next[target] = csvTestProfile(imported, importedName);
      added = appendCsv(next[target], imported, importedName);
      await commit(next);
      profileKey = target;
      localStorage.setItem('crew-health-profile', target);
    } finally { busy = false; }
    toast(added + ' check-ins imported. ' + (imported.length - added) + ' exact duplicates skipped. The dashboard now reflects the imported data.');
  });
  const submit = $('#dialog-body [type=submit]');
  submit.disabled = true;
  $('#csv-file').onchange = async event => {
    const version = ++generation;
    records = [];
    submit.disabled = true;
    $('#csv-preview').textContent = 'Validating file…';
    $('#dialog-body .form-error').textContent = '';
    try {
      const file = event.target.files[0];
      if (!file || !/\.csv$/i.test(file.name)) throw Error('Select a .csv file.');
      if (file.size > csvLimit) throw Error('CSV files must be 1 MB or smaller.');
      const parsed = await parseCsv(await file.text());
      if (version !== generation) return;
      records = parsed;
      filename = file.name;
      const synthetic = records.every(record => record.source === 'CSV · Synthetic');
      $('#csv-destination option[value=test]').disabled = !synthetic;
      $('#csv-destination').value = synthetic ? 'test' : 'current';
      const columns = ['Day', 'UTC', 'Phase', 'Source', ...Object.values(metrics).map(field => field.label + ' (' + field.unit + ')'), 'Mood', 'Context'];
      $('#csv-preview').innerHTML = '<p><strong>' + records.length + ' valid rows</strong> · Mission days ' + Math.min(...records.map(record => record.day)) + '–' + Math.max(...records.map(record => record.day)) + '</p><div class="table-scroll"><table><caption>All uploaded observations</caption><thead><tr>' + columns.map(label => '<th>' + label + '</th>').join('') + '</tr></thead><tbody>' + records.map(record => '<tr>' + [record.day, utc(record.time), record.phase, record.source, ...Object.keys(metrics).map(key => record.values[key] ?? '—'), record.values.mood ?? '—', record.context].map(value => '<td>' + escape(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
      submit.disabled = false;
    } catch (error) {
      if (version !== generation) return;
      $('#csv-preview').textContent = 'No rows imported. Fix the file and select it again.';
      $('#dialog-body .form-error').textContent = error.message;
    }
  };
}
function checkin(correctionId) {
  const old = profile().records.find(record => record.id === correctionId);
  const id = crypto.randomUUID();
  modal(old ? 'Correct an observation' : 'Record a check-in', `<form><p class="muted">Leave unmeasured fields blank. Times are UTC. Technical input bounds validate entry format and do not define safe values.</p><div class="form-grid"><label>Mission day<input name="day" type="number" min="1" max="10000" required value="${old?.day || profile().day}"></label><label>Collection time (UTC)<input name="time" type="datetime-local" required value="${old?.time.slice(0, 16) || nowInput()}"></label></div>
    ${Object.entries(metrics).map(([key, field]) => '<label>' + field.label + ' <span class="muted">(' + field.unit + ')</span><input name="' + key + '" type="number" min="' + field.min + '" max="' + field.max + '" step="' + field.step + '" value="' + (old?.values[key] ?? '') + '"><small>' + field.help + '</small></label>').join('')}
    <label>Mood<select name="mood"><option value="">Skip</option>${['Very low', 'Low', 'Neutral', 'Good', 'Very good'].map(mood => '<option ' + (old?.values.mood === mood ? 'selected' : '') + '>' + mood + '</option>').join('')}</select></label>
    <label>Related event or repeat request<select name="related"><option value="">No linked event</option>${[...profile().events.map(event => ({ id: event.id, title: event.text })), ...profile().reviews.filter(review => /request/i.test(review.type)).map(review => ({ id: review.id, title: review.type + ' · ' + review.reference }))].map(item => '<option value="' + item.id + '" ' + (old?.related === item.id ? 'selected' : '') + '>' + escape(item.title) + '</option>').join('')}</select></label><label>Measurement context<textarea name="context" maxlength="1000" placeholder="Posture, activity, thermometer method, meal timing or shift change">${escape(old?.context)}</textarea></label>
    <label>Private onboard note<textarea name="note" maxlength="2000">${escape(old?.note)}</textarea><small>Saved only on this device.</small></label>
    ${old ? '<label>Reason for correction<input name="reason" required maxlength="300"></label>' : ''}${formEnd()}`, async fields => {
      const values = {};
      for (const key of Object.keys(metrics)) if (fields.get(key) !== '') values[key] = Number(fields.get(key));
      if (fields.get('mood')) values.mood = fields.get('mood');
      const record = { id, time: new Date(fields.get('time') + 'Z').toISOString(), day: Number(fields.get('day')), phase: old?.phase || profile().phase, values, source: 'Crew entry', context: fields.get('context'), note: fields.get('note'), related: fields.get('related') };
      if (old) { record.replaces = old.id; record.reason = fields.get('reason'); }
      record.recordedAt = new Date().toISOString();
      if (old?.importFile) record.originalImport = old.originalImport || { file: old.importFile, row: old.importRow, time: old.importedAt };
      await changeProfile(data => addObservation(data, record));
      location.hash = 'dashboard';
      toast('Check-in saved. ' + readingFindings(profile()).length + ' readings outside demo references.');
    });
}
function missionSettings() {
  modal('Mission settings', '<form><label>Mission day<input name="day" type="number" min="1" max="10000" value="' + profile().day + '" required></label><label>Phase<select name="phase">' + ['Preflight', 'Transit', 'Surface', 'Re-entry', 'Recovery'].map(phase => '<option ' + (profile().phase === phase ? 'selected' : '') + '>' + phase + '</option>').join('') + '</select></label><p>Sleep comparison uses the demo’s fictional 7–8 h reference. Manual entries have no reference until a verified baseline workflow is integrated.</p>' + formEnd(), async fields => {
    const day = Number(fields.get('day'));
    if (!Number.isInteger(day) || day < 1 || day > 10000) throw Error('Enter a valid mission day.');
    await changeProfile(data => { data.day = day; data.phase = fields.get('phase'); });
    toast('Mission settings saved onboard.');
  });
}
function report() {
  modal('Record a symptom or event', '<form><label>Body system<select name="system">' + systems.map(system => '<option value="' + system.id + '" ' + (selected === system.id ? 'selected' : '') + '>' + system.label + '</option>').join('') + '</select></label><label>Event time (UTC)<input name="time" type="datetime-local" value="' + nowInput() + '" required></label><label>What happened?<textarea name="text" maxlength="1000" required></textarea></label><label class="checkbox"><input name="urgent" type="checkbox">I need immediate crew medical help</label><p class="muted">Urgent reports appear immediately in the onboard queue. This app does not contact the crew or ground.</p>' + formEnd(), async fields => {
    const text = fields.get('text').trim();
    if (!text) throw Error('Describe the concern.');
    await changeProfile(data => data.events.push({ id: crypto.randomUUID(), system: fields.get('system'), text, time: new Date(fields.get('time') + 'Z').toISOString(), day: data.day, urgent: fields.has('urgent'), owner: 'Crew medical officer', outcome: '', acknowledged: '' }));
    toast('Crew report saved. Contact your crew medical officer directly for an urgent concern.');
  });
}
function findingDialog(id) {
  const finding = readingFindings(profile()).find(item => item.id === id);
  if (!finding) return;
  modal('Reading evidence & action', '<h3>' + escape(finding.label) + '</h3><p>' + escape(finding.value) + ' ' + (metrics[finding.key]?.unit || '') + ' · Demo reference ' + escape(finding.reference) + '</p><p>' + utc(finding.record.time) + ' · ' + escape(finding.record.source) + '</p><p class="small muted">Evaluated when this view opened. ' + finding.rule + '. Measurement context: ' + escape(finding.record.context || 'Not recorded') + '</p><div class="guidance"><h3>Demo review checklist v1</h3><ol><li>Check the entered value, units, device and collection context.</li><li>Use the approved onboard measurement procedure to confirm a suspect reading.</li><li>Record symptoms and contact the crew medical officer for assessment.</li></ol><p>These fictional demo thresholds require mission validation.</p></div>' + (finding.review?.actions || []).map(action => '<p>' + utc(action.time) + ' · ' + escape(action.note) + '</p>').join('') + '<form><label>Action taken or next step<textarea name="note" required maxlength="1000"></textarea></label>' + formEnd('Record review'), async fields => {
    await changeProfile(data => reviewFinding(data, id, fields.get('note'), new Date().toISOString()));
    toast('Review saved. The source reading remains visible until new evidence changes the finding.');
  });
}
function eventDialog(id) {
  const event = profile().events.find(item => item.id === id);
  modal('Crew event & onboard guidance', '<p class="status-label urgent-text">' + (event.urgent ? '⬣ Act now' : '△ Review') + '</p><h3>' + escape(event.text) + '</h3>' + (event.actions || []).map(action => '<p class="event-action"><strong>' + utc(action.time) + '</strong><br>' + escape(action.text || 'Acknowledged') + '</p>').join('') + '<p>' + utc(event.time) + ' · Crew report</p><div class="guidance"><h3>Contact the crew medical officer directly</h3><p>Follow the mission’s approved onboard procedure for this event. No mission procedure has been loaded into this prototype.</p><p>Ground delivery and sensor confirmation may be unavailable. This screen cannot call for help.</p></div><form><label>Outcome or follow-up<textarea name="outcome" maxlength="1000" placeholder="What action was taken and what remains due?"></textarea></label><label>Record action<select name="action"><option value="ack">Acknowledge and keep open</option><option value="close">Close with outcome</option></select></label>' + formEnd('Save event update'), async fields => {
    await changeProfile(data => updateEvent(data.events.find(item => item.id === id), fields.get('action'), fields.get('outcome'), new Date().toISOString()));
    toast('Event updated onboard.');
  });
}
function sleepFollowup() {
  const saved = profile().followups.find(task => task.type === 'sleep' && task.day === profile().day);
  modal('Review sleep schedule', '<form><p>The two recorded nights fall below the fictional personal preflight reference. Review scheduled sleep opportunities and record any disruption.</p><label>Schedule or disruption note<textarea name="text" maxlength="1000" required placeholder="Example: shift changed; review planned sleep opportunity">' + escape(saved?.title?.replace(/^Sleep schedule: /, '') || '') + '</textarea></label><label>Follow-up mission day<input name="due" type="number" min="' + profile().day + '" max="10000" value="' + (saved?.due || profile().day + 1) + '" required></label>' + formEnd('Save follow-up'), async fields => {
    await changeProfile(data => {
      const existing = data.followups.find(task => task.type === 'sleep' && task.day === data.day);
      const task = { id: existing?.id || crypto.randomUUID(), type: 'sleep', day: data.day, title: 'Sleep schedule: ' + fields.get('text'), due: Number(fields.get('due')), outcome: '' };
      if (existing) {
        const revisions = [...(existing.revisions || []), { title: existing.title, due: existing.due, time: new Date().toISOString() }];
        Object.assign(existing, task, { revisions });
      } else data.followups.push(task);
    });
    toast('Sleep follow-up saved onboard. Due items appear in Attention.');
  });
}
function taskOutcome(id) {
  modal('Record follow-up outcome', '<form><label>Outcome<textarea name="outcome" required maxlength="1000"></textarea></label>' + formEnd('Close follow-up'), async fields => {
    if (!fields.get('outcome').trim()) throw Error('Enter an outcome.');
    await changeProfile(data => { data.followups.find(task => task.id === id).outcome = fields.get('outcome').trim(); });
    toast('Follow-up closed with outcome.');
  });
}
function history(initial) {
  modal('Observations & seven-day trends', '<label>Indicator<select id="trend-key">' + [...Object.entries(metrics).map(([key, field]) => [key, field.label]), ['mood', 'Mood']].map(([key, label]) => '<option value="' + key + '" ' + (key === initial ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label><div id="trend"></div>');
  $('#trend-key').onchange = () => drawTrend($('#trend-key').value);
  drawTrend(initial);
}
function drawTrend(key) {
  const data = profile();
  const records = currentRecords(data.records).filter(record => record.values[key] !== undefined);
  const days = Array.from({ length: 7 }, (_, index) => data.day - 6 + index).filter(day => day > 0);
  const daily = days.map(day => records.filter(record => record.day === day).at(-1));
  const max = Math.max(...daily.map(record => typeof record?.values[key] === 'number' ? record.values[key] : 0), key === 'sleep' ? data.baseline?.high || 8 : 1);
  $('#trend').innerHTML = '<p class="small muted">Daily latest values · Gaps stay unmeasured · ' + (key === 'sleep' && data.baseline ? escape(data.baseline.source) + ' ' + data.baseline.low + '–' + data.baseline.high + ' h · Sample count unavailable' : 'Personal reference unavailable') + '</p><div class="chart">' + days.map((day, index) => '<div class="chart-day"><span>' + (daily[index] ? escape(daily[index].values[key]) : '—') + '</span><div class="bar-space">' + (typeof daily[index]?.values[key] === 'number' ? '<div class="bar" style="height:' + Math.max(2, daily[index].values[key] / max * 100) + '%"></div>' : '') + '</div><small>D' + day + '</small></div>').join('') + '</div><div class="table-scroll"><table><caption>Source observations · ' + (metrics[key]?.unit || 'Self-report') + '</caption><thead><tr><th>Day / UTC</th><th>Value</th><th>Source & context</th></tr></thead><tbody>' + records.map(record => '<tr><td>D' + record.day + '<br>' + utc(record.time) + '</td><td>' + escape(record.values[key]) + ' ' + (metrics[key]?.unit || '') + '</td><td>' + escape(record.source) + '<br>' + escape(record.phase) + '<br>' + escape(record.context || 'Context not released') + '</td></tr>').join('') + '</tbody></table></div>' + (!records.length ? '<p>No observations for this indicator.</p>' : '');
}
$('#close-dialog').onclick = () => $('#dialog').close();
$('#help').onclick = () => modal('Crew medical help', '<div class="guidance"><h3>Contact the crew medical officer now for an urgent concern</h3><p>Use the mission’s approved communication and emergency procedure. This prototype has no loaded medical protocols and cannot call or transmit a distress message.</p></div><button id="urgent-report" class="danger-button wide">Record an urgent crew report</button>');
$('#dialog-body').addEventListener('click', event => { if (event.target.id === 'urgent-report') { $('#dialog').close(); report(); $('input[name=urgent]').checked = true; } });
$('#sources').onclick = () => modal('Research & scope', '<p>Based on the supplied challenge brief and agency resources. All 17 NASA risk categories have a destination in the system list. Specialized exams display their availability; this prototype does not infer a disease from routine vitals.</p><ul class="source-list">' + sources.map(([label, url]) => '<li><a target="_blank" rel="noreferrer" href="' + url + '">' + label + ' ↗</a></li>').join('') + '</ul><p class="small muted"><a href="assets/anatomy-ATTRIBUTION.md" target="_blank">BodyParts3D © DBCLS · Adapted by Open Anatomy 3D</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a><br>Layer colors and visibility modified · Male reference anatomy</p><p>The sleep comparison uses an explicitly fictional preflight reference. Real crew records require appropriate access controls and mission-approved protocols.</p>');
document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { location.hash = button.dataset.page; });
window.addEventListener('hashchange', () => {
  if (!['', '#dashboard', '#profile'].includes(location.hash)) return;
  page = location.hash === '#profile' ? 'profile' : 'dashboard';
  render();
});
function updateConnection() {
  const indicator = $('.connection');
  if (indicator) indicator.innerHTML = '<i></i>' + (navigator.onLine ? 'Local workspace' : 'Offline');
}
window.addEventListener('online', updateConnection);
window.addEventListener('offline', updateConnection);
try {
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('crew-health', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const stored = await new Promise((resolve, reject) => {
    const request = db.transaction('state').objectStore('state').get('profiles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (stored) state = stored;
  if (!state[profileKey]?.records) profileKey = 'demo';
  storageReady = true;
} catch { toast('Local storage could not be opened. Reload with browser storage enabled before entering records.', true); }
render();
if ('serviceWorker' in navigator) {
  try { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; $('#cache-status').textContent = 'Offline cache ready'; }
  catch { $('#cache-status').textContent = 'Offline cache unavailable · Keep the server running'; }
} else $('#cache-status').textContent = 'Offline cache requires localhost or HTTPS';
