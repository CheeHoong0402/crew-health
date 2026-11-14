import { updateMotion } from './motion.js';
import { appendHazardCsv, hazardColumns } from './hazard-csv.js';
import './assets/model-viewer.min.js';
customElements.get('model-viewer').meshoptDecoderLocation = new URL('./assets/meshopt_decoder.js', import.meta.url).href;
import { metrics, systems, sources, freshProfile, latest, currentRecords, sleepFlag, validateRecord, validatePersonal, updateEvent, openRegionEvents, readingFindings, demoRules, addObservation, reviewFinding, sevenDayReadings } from './model.js';
import { parseCsv, appendCsv, csvTestProfile, csvLimit } from './csv.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const utc = value => new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const nowInput = () => new Date().toISOString().slice(0, 16);
let state = { demo: freshProfile(true), manual: freshProfile(false) };
let profileKey = localStorage.getItem('crew-health-profile') || 'demo';
let page = ['#dashboard', '#profile', '#log'].includes(location.hash) ? location.hash.slice(1) : 'home';
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
  return record ? escape(record.values[key]) + ' <small>' + (metrics[key]?.unit || '') + '</small>' : '<span class="muted">' + 'No reading' + '</span>';
}
function render() {
  document.querySelectorAll('[data-page]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.page === page)));
  const data = profile();
  $('#main').className = 'page-' + page;
  if (page === 'home') {
    $('#main').innerHTML = landingPage(data);
    updateMotion(page);
    return;
  }
  $('#main').innerHTML = `
    <section class="mission-bar">
      <div><span class="eyebrow">Your crew health workspace</span><h1>${page === 'dashboard' ? 'Health dashboard' : page === 'log' ? 'Activity log' : 'Astronaut profile & data'}</h1><p>${escape(data.personal?.name || 'Crew member')} ${escape(data.personal?.astronautId || 'A-07')} <span class="separator">/</span> Day ${data?.day ?? profile().day} <span class="separator">/</span> ${escape(data?.phase ?? profile().phase)}</p></div>
      <div class="mission-controls"><label class="small">Profile <select id="astronaut-profile">${Object.entries(state).filter(([, data]) => Array.isArray(data?.records)).map(([key, data]) => '<option value="' + key + '" ' + (key === profileKey ? 'selected' : '') + '>' + escape(data.label || (key === 'demo' ? 'Simulated mission' : 'Manual entries')) + '</option>').join('')}</select></label><span class="connection"><i></i>${navigator.onLine ? 'Local workspace' : 'Offline'}</span><span class="small muted">${storageReady ? 'Stored on this device' : 'Storage unavailable'}</span></div>
    </section>
    <div class="workspace-note"><span>${escape(data.label || (profileKey === 'demo' ? 'Simulated mission data' : 'Manual entries'))} · ${data.records.length} recorded entries</span></div>
    ${page === 'dashboard' ? dashboard(data) : page === 'log' ? logPage(data) : personalPage(data)}
  `;
  bindDashboard();
  updateMotion(page);
}

function landingPage(data) {
  return `
    <section class="mediva-hero" aria-labelledby="home-title">
      <div class="hero-intro"><h1 id="home-title">Supporting Crew Health<br>Across Every Mission</h1><p>A clearer view of astronaut wellbeing—bringing observations,<br class="desktop-break"> evidence, and crew actions together, even far from Earth.</p><div class="hero-actions"><a class="button-link primary" href="#dashboard"><span class="round-icon" aria-hidden="true">↗</span> Open Dashboard</a><a class="button-link secondary" href="#home-workflows">See How It Works <span class="round-icon" aria-hidden="true">→</span></a></div></div>
      <div class="hero-gallery">
        <a class="hero-photo nasa-exercise" href="#profile" aria-label="Open crew observations and data input"><span class="photo-chip">Crew observations</span><span class="gallery-arrow" aria-hidden="true">↗</span><span class="photo-credit">NASA · Steve Swanson exercising aboard the ISS</span></a>
        <a class="hero-photo nasa-medical gallery-main" href="#dashboard" aria-label="Explore the crew health dashboard"><span class="gallery-arrow main-arrow" aria-hidden="true">↗</span><div class="glass-caption"><span class="glass-orbit" aria-hidden="true">◎</span><strong>Human health.<br>Mission context.</strong><span>Explore the working prototype <span aria-hidden="true">↗</span></span></div><span class="photo-credit">NASA · Spinal Ultrasound investigation</span></a>
        <a class="hero-photo app-preview" href="#dashboard" aria-label="Review latest readings in the dashboard"><span class="app-preview-top">CREW HEALTH <span>Selected profile</span></span><h2>A closer look<br>at wellbeing.</h2><div class="app-preview-reading"><span>Resting heart rate</span><strong>${valueOf(data, 'pulse')}</strong></div><div class="app-preview-reading"><span>Hours of sleep</span><strong>${valueOf(data, 'sleep')}</strong></div><span class="app-preview-foot">Latest available observations <span aria-hidden="true">↗</span></span></a>
      </div>
    </section>
    <section class="mediva-services" id="home-workflows" aria-labelledby="services-title">
      <div class="mediva-section-heading"><h2 id="services-title">The Right Information.<br>A Clearer Next Step.</h2><p>From a daily check-in to a closer look at the evidence, keep the crew’s observations and actions in one local workspace.</p></div>
      <div class="service-grid">
        <article class="service-card"><span class="service-icon" aria-hidden="true">${uiIcon('input')}</span><h3>Health Data Input</h3><p>Import health and mission CSVs, or record a manual check-in. Preview validated records before saving.</p></article>
        <article class="service-card"><span class="service-icon" aria-hidden="true">${uiIcon('heart')}</span><h3>Body System Review</h3><p>Explore reference anatomy and connect available readings with the relevant body system.</p></article>
        <article class="service-card"><span class="service-icon" aria-hidden="true">${uiIcon('trend')}</span><h3>Observations & Trends</h3><p>See seven-day readings, source details, and fictional demo findings that need crew review.</p></article>
        <article class="service-card"><span class="service-icon" aria-hidden="true">${uiIcon('sun')}</span><h3>Sleep & Wellbeing</h3><p>Review sleep and mood, record a support request, and keep sleep follow-ups visible.</p></article>
      </div><div class="center-action"><a class="button-link primary" href="#dashboard">View the Workspace <span class="round-icon" aria-hidden="true">→</span></a></div>
    </section>
    <section class="mediva-features" aria-label="Crew wellbeing and evidence">
      <article class="alternating-feature"><div class="feature-copy"><h2>Supporting Wellbeing<br>Beyond Earth</h2><p>Long missions bring changing routines and time away from home. Review sleep, mood, and shift context together, with a clear record of the crew’s next step.</p><ul class="check-list"><li>Sleep and mood observations</li><li>Visible short-sleep demo findings</li><li>Onboard crew support requests</li><li>Scheduled sleep follow-ups</li></ul><a class="button-link primary" href="#dashboard">Review Wellbeing <span class="round-icon" aria-hidden="true">→</span></a></div><figure class="feature-photo nasa-cupola" role="img" aria-label="NASA astronaut Jessica Watkins in the International Space Station cupola"><figcaption>NASA · Jessica Watkins aboard the ISS</figcaption></figure></article>
      <article class="alternating-feature"><figure class="feature-photo nasa-medical" role="img" aria-label="NASA astronaut Chris Cassidy performing an ultrasound on Luca Parmitano aboard the ISS"><figcaption>NASA · Spinal Ultrasound investigation</figcaption></figure><div class="feature-copy"><h2>Evidence You Can Trace.<br>Actions You Can Follow.</h2><p>Give each observation its context. Review the time, source, mission phase, and correction history before recording an action or follow-up.</p><ul class="check-list"><li>Original observations retained</li><li>Source rows and import times</li><li>Audited corrections and crew actions</li><li>Local storage for offline review</li></ul><a class="button-link primary" href="#log">Explore the Activity Log <span class="round-icon" aria-hidden="true">→</span></a></div></article>
    </section>
    <section class="mediva-specialties" aria-labelledby="specialties-title"><div class="mediva-section-heading"><h2 id="specialties-title">A Closer Look at Crew Health</h2><p>Explore the app’s health and mission views. Missing measurements remain visibly unassessed.</p></div><div class="specialty-grid">
      <a class="specialty-card anatomy-tile" href="#dashboard"><div class="specialty-visual"><model-viewer src="assets/anatomy.glb" alt="Educational reference anatomy" camera-orbit="-15deg 90deg 100%" exposure="1.1" interaction-prompt="none" disable-pan></model-viewer></div><span class="specialty-label">Body Systems <span aria-hidden="true">↗</span></span></a>
      <a class="specialty-card sleep-tile" href="#dashboard"><div class="specialty-visual"><span class="tile-eyebrow">FICTIONAL DEMO</span><strong>Sleep &<br>wellbeing.</strong><div class="sleep-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><small>7-day observations</small></div><span class="specialty-label">Sleep & Mood <span aria-hidden="true">↗</span></span></a>
      <a class="specialty-card" href="#profile"><div class="specialty-visual nasa-exercise" role="img" aria-label="NASA astronaut exercising on the ISS treadmill"></div><span class="specialty-label">Crew Observations <span aria-hidden="true">↗</span></span></a>
      <a class="specialty-card" href="#log"><div class="specialty-visual nasa-cupola" role="img" aria-label="NASA astronaut in the space station cupola"></div><span class="specialty-label">Mission Evidence <span aria-hidden="true">↗</span></span></a>
    </div></section>
    <section class="mediva-pathways" aria-labelledby="pathways-title"><div class="pathway-menu"><p>Your Mission Workspace:<br> Connected Context for<br> Every Health Review</p><a href="#dashboard" class="pathway-active">Health Dashboard <span aria-hidden="true">↗</span></a><a href="#profile">Profile & Data <span aria-hidden="true">↗</span></a><a href="#log">Activity Log <span aria-hidden="true">↗</span></a><a href="#home-scope">Five-Hazard Scope <span aria-hidden="true">↗</span></a></div><div class="pathway-content"><h2 id="pathways-title">Your Crew, Our Focus.<br>Every Step of the Mission.</h2><div class="crew-fan" aria-label="NASA mission photography and app preview gallery"><div class="fan-card nasa-cupola"></div><div class="fan-card fan-app"><span>CSV</span><i></i><i></i><i></i><i></i></div><div class="fan-card nasa-exercise"></div><div class="fan-card nasa-medical"></div><div class="fan-card fan-app fan-reading"><span>Sleep</span><strong>5 <small>h</small></strong><small>Fictional demo</small></div><div class="fan-card nasa-cupola"></div><div class="fan-card nasa-exercise"></div></div><a class="button-link" href="#dashboard">Explore Crew Health <span class="round-icon" aria-hidden="true">↗</span></a><p class="gallery-disclaimer">NASA imagery provides mission context; pictured astronauts are not product users or endorsers.</p></div></section>
    <section class="mediva-scope" id="home-scope"><p><strong>Five spaceflight hazards, one crew health context.</strong> Radiation; isolation and confinement; distance from Earth; changing gravity; hostile and closed environments. This prototype brings available observations and imported records into review. Personal dose calculations, cabin exposure evaluation, live devices, mission protocols, and ground delivery remain pending.</p></section>
    <section class="mediva-closing"><p>A local health workspace. A clearer view of the mission.</p><h2>EXPLORE CREW HEALTH</h2><p>Start with fictional demo observations, bring in your data,<br>and follow the evidence through the working app.</p><a class="button-link primary" href="#dashboard">Open the Demo <span class="round-icon" aria-hidden="true">↗</span></a></section>
  `;
}

function uiIcon(name) {
  const paths = {
    input: '<path d="M8 3h8l4 4v14H4V3h4m8 0v5h5M8 13h8m-8 4h5"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/><path d="M3 12h5l2-4 4 8 2-4h5"/>',
    trend: '<path d="M3 3v18h18M6 16l5-6 4 3 6-8m-5 0h5v5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>';
}


function systemContext(id) {
  if (id === 'exposure') return '<h3>Space radiation</h3><p>Personal dosimetry and spacewalk intervals are required. Dose coverage is unavailable.</p>';
  if (id === 'operations') return '<h3>Hostile / closed environment</h3><p>Cabin CO₂, pressure, temperature and compartment logs are unavailable.</p><h3>Distance from Earth</h3><p>Records and crew actions save locally for offline review. Ground receipt is unconfirmed.</p>';
  if (id === 'sleep') return '<h3>Isolation & confinement</h3><p>Review sleep, mood and shift context together. Record a support request even with no measurements.</p>';
  if (['spine', 'limbs', 'head', 'eyes', 'heart', 'kidneys'].includes(id)) return '<h3>Gravity fields</h3><p>Interpret observations with activity, posture and mission phase. Gravity-transition records and specialized exams are unavailable.</p>';
  return '<h3>Hostile / closed environment</h3><p>Review symptoms alongside cabin conditions and nutrition context. Habitat and laboratory evidence require separate records.</p>';
}

function sourceDetails(record, rule = '') {
  const saved = record.importedAt || record.recordedAt;
  const origin = record.originalImport;
  return '<details class="source-details"><summary>Source details</summary><p>' + escape(record.source) + ' · Day ' + record.day + ' · ' + escape(record.phase) + '</p>' +
    (record.importFile ? '<p>' + escape(record.importFile) + ' · Row ' + record.importRow + '</p>' : '') +
    (origin ? '<p>Original import · ' + escape(origin.file) + ' · Row ' + origin.row + '</p>' : '') +
    '<p>Source ID ' + escape(record.id) + '</p><p>Saved / imported ' + (saved ? utc(saved) : 'time unavailable for legacy record') + '</p>' +
    (rule ? '<p>' + escape(rule) + '</p>' : '') + '</details>';
}

function findingCard(finding, data) {
  const record = finding.record;
  const flag = finding.key === 'sleep' ? sleepFlag(data) : null;
  const task = finding.key === 'sleep' ? data.followups.find(item => item.type === 'sleep' && item.day === data.day) : null;
  return `<article class="alert watch reading-finding" data-locate="${finding.system}" tabindex="0" aria-label="${escape(finding.label)}; select to locate body system"><span class="status-label">${finding.review ? 'Reviewed · Reading still outside demo reference' : '△ Reading review'}</span><h3>${escape(finding.label)}</h3><p class="finding-value">${escape(finding.value)} <small>${metrics[finding.key]?.unit || ''}</small></p><p class="small">Demo reference · ${escape(finding.reference)}</p><p class="small muted">${utc(record.time)}</p>${flag ? '<p class="small">Two consecutive short nights · Day ' + flag.previous.day + ': ' + flag.previous.values.sleep + ' h · Day ' + flag.current.day + ': ' + flag.current.values.sleep + ' h</p>' : ''}${task ? '<p class="small">' + (task.outcome ? 'Follow-up completed' : 'Follow-up due day ' + task.due) + '</p>' : ''}${sourceDetails(record, finding.rule)}<p class="owner">${finding.review ? 'Crew review recorded' : 'Awaiting crew review'}</p><button data-finding="${finding.id}" class="wide">Review & record action</button></article>`;
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
  const pendingCount = readingFindings(data).filter(item => !item.review).length;
  const system = systems.find(item => item.id === selected);
  return `
    <section class="review-strip"><div><strong>${pendingCount} reading${pendingCount === 1 ? '' : 's'} to review</strong><span>Latest available observations · Demo rules v1</span><details class="rule-reference"><summary>View alert thresholds</summary><p>Fictional demo references, inclusive boundaries. Outside these ranges prompts review.</p><ul>${Object.entries(demoRules).map(([key, rule]) => '<li>' + (metrics[key]?.label || 'Mood') + ' · ' + (key === 'mood' ? 'Low or Very low' : (key === 'sleep' ? (data.baseline?.low ?? rule.low) + '–' + (data.baseline?.high ?? rule.high) : rule.low + '–' + rule.high) + ' ' + metrics[key].unit) + '</li>').join('')}</ul></details></div><div class="input-actions"><button data-open-log>Log</button><button id="quick-checkin" class="primary">＋ Record check-in</button></div></section>
    <section class="panel latest"><div class="panel-heading"><h2>Latest readings</h2><button id="open-data-latest">Open data input</button></div>
      <div class="metric-strip">${['pulse', 'systolic', 'temperature', 'sleep', 'mood', 'glucose'].map(key => '<button class="metric ' + (readingFindings(data).some(finding => finding.key === key || key === 'systolic' && finding.key === 'diastolic') ? 'metric-watch' : '') + '" data-metric="' + key + '"><span>' + (key === 'systolic' ? 'Blood pressure' : metrics[key]?.label || 'Mood') + '</span><strong>' + (key === 'systolic' && latest(data.records, key) ? escape(latest(data.records, key).values.systolic) + '/' + escape(latest(data.records, key).values.diastolic ?? '—') + ' <small>mmHg</small>' : valueOf(data, key)) + '</strong></button>').join('')}</div>
    </section>
    <div class="dashboard">
      <section class="panel attention"><div class="panel-heading"><h2>Attention queue</h2></div>${attention(data)}</section>
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
      <section class="panel evidence"><details class="system-menu"><summary><span>Review body system</span><strong role="heading" aria-level="2">${system.label}</strong></summary><div class="system-list" aria-label="Body system selection">${systems.map(item => '<button data-system="' + item.id + '" aria-pressed="' + (item.id === selected) + '">' + item.label + '</button>').join('')}</div></details>
        <div class="evidence-body">${openRegionEvents(data, system.id).map(event => `<div class="region-event"><strong>${event.urgent ? 'Urgent' : 'Review'} · ${escape(event.text)}</strong><p>${utc(event.time)} · Crew report</p><button data-event="${escape(event.id)}">Open event & record action</button></div>`).join('')}${system.keys.length ? system.keys.map(key => {
          const record = latest(data.records, key);
          const finding = readingFindings(data).find(item => item.key === key);
          return '<div class="reading"><span>' + (metrics[key]?.label || 'Mood') + '</span><strong>' + valueOf(data, key) + '</strong></div>' +
            (finding ? '<button class="reading-badge" data-finding="' + finding.id + '">' + (finding.review ? 'Reviewed' : 'Review reading') + '</button>' : '') +
            (record ? '<p class="small muted">' + utc(record.time) + '</p>' : '') + trendChart(data, key) + (record ? sourceDetails(record) : '');
        }).join('') : '<div class="unavailable">○ No exam on file</div>'}
        ${missionEvidence(data, selected)}<p class="evidence-explanation">${system.evidence}</p>
        <details><summary>Associated research risks</summary><ul>${system.risks.map(risk => '<li>' + risk + '</li>').join('')}</ul><a href="${sources[1][1]}" target="_blank" rel="noreferrer">NASA risk reference ↗</a></details>
        <button id="history" class="wide">View observations & trends</button>
        <button id="report" class="subtle wide">＋ Record symptom or event</button>
        </div>
        <div class="exposure">${systemContext(system.id)}</div>
      </section>
    </div>

`;

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
  const inputs = items => items.map(([key, label, type, length]) => '<label>' + label + '<input name="' + key + '" type="' + type + '" value="' + escape(personal[key] ?? '') + '"' + (length ? ' maxlength="' + length + '"' : '') + (type === 'number' ? ' min="0.1" max="1000" step="0.1"' : '') + (type === 'date' ? ' max="' + new Date().toISOString().slice(0, 10) + '"' : '') + '></label>').join('');
  return `<div class="profile-grid">
    <section class="panel"><div class="panel-heading"><h2>Personal information</h2></div>
      <form id="personal-form" class="profile-form"><p class="small muted">Details save on this device.</p>
        <div class="form-grid">${inputs(fields.slice(0, 4))}</div>
        <details class="medical-details"><summary>Optional medical details</summary><div class="form-grid">${inputs(fields.slice(4))}</div>
        <label>Blood group<select name="bloodGroup"><option value="">Not recorded</option>${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(group => '<option ' + (group === personal.bloodGroup ? 'selected' : '') + '>' + group + '</option>').join('')}</select></label>
        </details><p class="form-error" role="alert"></p><button type="submit" class="primary">Save personal information</button>
      </form>
    </section>
    <section class="panel data-input"><div class="panel-heading"><h2>CSV & crew observations</h2></div>
      <div class="evidence-body"><p>Import readings or record a check-in.</p>
        <button id="import-csv" class="primary wide">Import CSV</button><button id="checkin" class="wide">＋ Record check-in</button><button id="report" class="subtle wide">＋ Record symptom or event</button>
        <div class="profile-mission"><h3>Mission context</h3><p>Day ${data.day} · ${escape(data.phase)}</p><p class="small muted">${escape(personal.missionName || 'Mission name not recorded')}</p><button id="mission" class="wide">Edit mission day & phase</button></div>
        <details class="profile-mission"><summary>Test datasets</summary><p class="small muted">Seven synthetic days per scenario. Test files open in separate profiles.</p><p><a href="data/testing/healthy-data.csv" download>Healthy data</a> · <a href="data/testing/unhealthy-data.csv" download>Unhealthy data</a> · <a href="data/testing/five-hazards-synthetic.csv" download>Five-hazard mission</a></p></details>
      </div>
    </section>
  </div>`;
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
  return '<div class="attention-content">' + readingFindings(data).map(finding => findingCard(finding, data)).join('') + events.map(event => `<article class="alert ${event.urgent ? 'urgent' : 'watch'}"><span class="status-label">${event.urgent ? '⬣ Act now' : '△ Review'}</span><h3>${escape(event.text)}</h3><p class="small">Crew report · ${utc(event.time)}</p><span class="evidence-tag">Self-reported · Sensor evidence unavailable</span><p class="owner">${escape(event.owner)} · ${event.urgent ? 'Now' : 'Review requested'}</p>${event.acknowledged ? '<p class="small muted">Acknowledged ' + utc(event.acknowledged) + '</p>' : ''}${'<button data-event="' + event.id + '" class="wide">Open event & onboard guidance</button>'}</article>`).join('') +
    (!events.length && !readingFindings(data).length && !data.followups.some(task => !task.outcome) ? '<div class="quiet"><h3>No open action flags</h3><p>Review available observations and scheduled follow-ups. Unmeasured systems remain unassessed.</p></div>' : '') +
    data.followups.map(task => '<div class="task"><strong>' + escape(task.title) + '</strong><p class="small">Due day ' + task.due + ' · ' + (task.outcome ? 'Closed · ' + escape(task.outcome) : 'Open') + '</p>' + (!task.outcome ? '<button data-task="' + task.id + '">Record outcome</button>' : '') + '</div>').join('') + '</div>';
}
function importedMissionRows(data) {
  return (state._missions?.[data.missionId]?.records || []).filter(row =>
    !row.astronaut_id || row.astronaut_id === data.astronautId);
}
function missionEvidence(data, systemId) {
  const rows = importedMissionRows(data).filter(row => !systemId || row.body_system === systemId ||
    (systemId === 'operations' && !row.body_system && !row.astronaut_id));
  if (!rows.length) return '';
  return '<details class="mission-evidence"><summary>Imported mission records (' + rows.length + ')</summary>' +
    rows.map(row => '<details class="source-details"><summary>' + escape(row.record_type.replaceAll('_', ' ') + ' · ' + row.record_id) + '</summary><dl>' +
      hazardColumns.filter(key => row[key] !== '').map(key => '<dt>' + escape(key.replaceAll('_', ' ')) + '</dt><dd>' + escape(row[key]) + '</dd>').join('') +
      '<dt>File / row</dt><dd>' + escape(row.importFile) + ' · ' + row.importRow + '</dd><dt>Imported on device</dt><dd>' + utc(row.importedAt) + '</dd></dl></details>').join('') + '</details>';
}
function logPage(data) {
  return '<section class="panel timeline"><div class="panel-heading"><h2>Observations, events & actions</h2><span class="small muted">UTC · Original records retained</span></div>' + timeline(data) + missionEvidence(data) + '</section>';
}
function timeline(data) {
  const rows = [...data.records.map(record => ({ ...record, title: record.replaces ? 'Corrected observation' : 'Check-in recorded', detail: Object.entries(record.values).map(([key, value]) => (metrics[key]?.label || key) + ' ' + value + ' ' + (metrics[key]?.unit || '')).join(' · ') })), ...data.events.map(event => ({ ...event, title: event.text, detail: event.outcome || 'Crew report · Review outcome pending' })), ...(data.reviews || []).flatMap(review => (review.actions || []).map(action => ({ time: action.time, title: 'Reading review · ' + (review.label || review.findingId), detail: action.note, related: review.sourceId || review.findingId })))].sort((a, b) => b.time.localeCompare(a.time));
  return rows.length ? '<ol class="timeline-list">' + rows.map(row => '<li><time>' + utc(row.time) + '</time><div><strong>' + escape(row.title) + '</strong><p>' + escape(row.detail) + '</p>' + (row.context ? '<p class="small muted">' + escape(row.context) + '</p>' : '') + (row.related ? '<p class="small muted">Linked record ' + escape(row.related) + '</p>' : '') + (row.replaces ? '<p class="small muted">Replaces ' + escape(row.replaces) + ' · ' + escape(row.reason) + '</p>' : '') + (page === 'log' && row.values && !data.records.some(record => record.replaces === row.id) ? '<button class="subtle" data-correct="' + row.id + '">Correct this entry</button>' : '') + '</div></li>').join('') + '</ol>' : '<p class="empty-copy">No observations recorded. Start with a check-in or symptom report.</p>';
}
function bindDashboard() {
  document.querySelectorAll('[data-open-log]').forEach(button => button.onclick = () => { location.hash = 'log'; });
  $('#astronaut-profile').onchange = event => { profileKey = event.target.value; localStorage.setItem('crew-health-profile', profileKey); selected = 'heart'; render(); };
  if ($('#mission')) $('#mission').onclick = missionSettings;
  if ($('#open-data-latest')) $('#open-data-latest').onclick = () => { location.hash = 'profile'; };
  if ($('#personal-form')) $('#personal-form').onsubmit = savePersonal;
  document.querySelectorAll('[data-system]').forEach(button => button.onclick = () => { selected = button.dataset.system; render(); });
  document.querySelectorAll('[data-locate]').forEach(card => {
    const locate = () => {
      selected = card.dataset.locate;
      render();
    };
    card.onclick = event => { if (!event.target.closest('button, a, details')) locate(); };
    card.onkeydown = event => {
      if (event.target === card && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        locate();
      }
    };
  });
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
}
function importCsv() {
  let records = [];
  let filename = '';
  let generation = 0;
  modal('Import health or mission CSV', `<form>
    <p>Upload comma-separated UTF-8 data, up to 1 MB and 1000 rows. Every row is validated before a single save.</p>
    <label>CSV file<input id="csv-file" type="file" accept=".csv,text/csv" required></label>
    <label>Destination<select id="csv-destination" name="destination"><option value="current">Append to current profile</option><option value="test">Separate synthetic test profile</option><option value="mission" disabled>Mission & crew profiles</option></select></label>
    <p class="small muted">A separate test profile uses the fictional 7–8 h sleep reference. Existing profiles retain their records, open events and reference settings.</p>
    <details><summary>CSV column format</summary><p>Combined mission format uses record_type and record_id with mission-scoped links. Use the five-hazards sample for all 44 columns. Each file imports into separate crew profiles with shared mission evidence.</p><p class="small">Health format required headers: mission_day, timestamp_utc, phase, data_kind. Optional measurements: heart_rate_bpm, systolic_mmhg, diastolic_mmhg, temperature_c, sleep_hours, mood, glucose_mgdl, context.</p><p class="small">Use UTC timestamps such as 2026-11-14T08:10:00Z. data_kind is synthetic or observed. Leave unavailable readings blank. Both blood pressure values are required when either is recorded.</p></details>
    <div id="csv-preview" aria-live="polite"><p>Select a file to preview its data.</p></div>
    ${formEnd('Import validated rows')}`, async fields => {
    const imported = records;
    const importedName = filename;
    if (!imported.length) throw Error('Select and validate a CSV file first.');
    if (imported[0].format === 'hazards') {
      if (busy) throw Error('A save is in progress. Please try again.');
      busy = true;
      try {
        const next = structuredClone(state);
        const result = appendHazardCsv(next, imported, importedName);
        await commit(next);
        profileKey = result.target;
        localStorage.setItem('crew-health-profile', profileKey);
        toast(result.added + ' mission records imported. Select an imported crew profile to review its evidence.');
      } finally { busy = false; }
      return;
    }
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
    toast(added + ' records imported. ' + (imported.length - added) + ' exact duplicates skipped. The dashboard now reflects the imported data.');
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
      const combined = records[0].format === 'hazards';
      $('#csv-destination').disabled = combined;
      if (combined) {
        $('#csv-destination').value = 'mission';
        $('#csv-preview').innerHTML = '<p><strong>' + records.length + ' valid mission rows</strong> · Imports into mission-scoped crew profiles. Linked IDs and existing-record conflicts are checked before saving.</p><div class="table-scroll"><table><caption>All combined mission fields</caption><thead><tr>' + hazardColumns.map(key => '<th>' + escape(key) + '</th>').join('') + '</tr></thead><tbody>' + records.map(row => '<tr>' + hazardColumns.map(key => '<td>' + escape(row[key]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
        const preview = structuredClone(state);
        appendHazardCsv(preview, records, filename);
        submit.disabled = false;
        return;
      }
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
  modal(old ? 'Correct an observation' : 'Record a check-in', `<form><p class="muted">Leave unmeasured fields blank. Times are UTC.</p><details><summary>Measurement help</summary><p>Technical input bounds validate entry format and do not define safe values.</p></details><div class="form-grid"><label>Mission day<input name="day" type="number" min="1" max="10000" required value="${old?.day || profile().day}"></label><label>Collection time (UTC)<input name="time" type="datetime-local" required value="${old?.time.slice(0, 16) || nowInput()}"></label></div>
    ${Object.entries(metrics).map(([key, field]) => '<label>' + field.label + ' <span class="muted">(' + field.unit + ')</span><input name="' + key + '" type="number" min="' + field.min + '" max="' + field.max + '" step="' + field.step + '" value="' + (old?.values[key] ?? '') + '"><small>' + field.help + '</small></label>').join('')}
    <label>Mood<select name="mood"><option value="">Skip</option>${['Very low', 'Low', 'Neutral', 'Good', 'Very good'].map(mood => '<option ' + (old?.values.mood === mood ? 'selected' : '') + '>' + mood + '</option>').join('')}</select></label>
    <label>Related event<select name="related"><option value="">No linked event</option>${[...profile().events.map(event => ({ id: event.id, title: event.text })), ].map(item => '<option value="' + item.id + '" ' + (old?.related === item.id ? 'selected' : '') + '>' + escape(item.title) + '</option>').join('')}</select></label><label>Measurement context<textarea name="context" maxlength="1000" placeholder="Posture, activity, thermometer method, meal timing or shift change">${escape(old?.context)}</textarea></label>
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
  modal('Mission settings', '<form><label>Mission day<input name="day" type="number" min="1" max="10000" value="' + profile().day + '" required></label><label>Phase<select name="phase">' + ['Preflight', 'Transit', 'Surface', 'Re-entry', 'Recovery'].map(phase => '<option ' + (profile().phase === phase ? 'selected' : '') + '>' + phase + '</option>').join('') + '</select></label><p>Readings use the demo references displayed under View alert thresholds.</p>' + formEnd(), async fields => {
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
  modal('Reading evidence & action', '<h3>' + escape(finding.label) + '</h3><p>' + escape(finding.value) + ' ' + (metrics[finding.key]?.unit || '') + ' · Demo reference ' + escape(finding.reference) + '</p><p>' + utc(finding.record.time) + ' · ' + escape(finding.record.source) + '</p><p class="small muted">Evaluated when this view opened. ' + finding.rule + '. Measurement context: ' + escape(finding.record.context || 'Not recorded') + '</p><div class="guidance"><h3>Demo review checklist v1</h3><ol><li>Check the entered value, units, device and collection context.</li><li>Use the approved onboard measurement procedure to confirm a suspect reading.</li><li>Record symptoms and contact the crew medical officer for assessment.</li></ol><p>These fictional demo thresholds require mission validation.</p></div>' + (finding.review?.actions || []).map(action => '<p>' + utc(action.time) + ' · ' + escape(action.note) + '</p>').join('') + (finding.key === 'sleep' ? '<button id="schedule-sleep" class="wide">Schedule sleep follow-up</button>' : '') + '<form><label>Action taken or next step<textarea name="note" required maxlength="1000"></textarea></label>' + formEnd('Record review'), async fields => {
    await changeProfile(data => reviewFinding(data, id, fields.get('note'), new Date().toISOString()));
    toast('Review saved. The source reading remains visible until new evidence changes the finding.');
  });
  if ($('#schedule-sleep')) $('#schedule-sleep').onclick = () => {
    $('#dialog').close();
    sleepFollowup();
  };
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
function trendChart(data, key) {
  const daily = sevenDayReadings(data, key);
  const label = metrics[key]?.label || 'Mood';
  const unit = metrics[key]?.unit || 'Self-report';
  if (!daily.some(item => item.record)) return '<p class="trend-empty small muted">No ' + escape(label.toLowerCase()) + ' readings in the last seven mission days.</p>';
  if (key === 'mood') {
    return '<figure class="inline-trend"><figcaption>7-day mood history · Daily latest</figcaption><ol class="mood-history">' + daily.map(({ day, record }) =>
      '<li><span>Day ' + day + '</span><strong>' + escape(record?.values.mood ?? 'No reading') + '</strong></li>').join('') + '</ol></figure>';
  }
  const max = Math.max(1, ...daily.map(item => item.record?.values[key] ?? 0));
  return '<figure class="inline-trend"><figcaption>7-day trend · ' + unit + ' · Daily latest</figcaption><div class="mini-chart" role="img" aria-label="' +
    escape(label + ', ' + unit + '. Bars start at zero. ' + daily.map(({ day, record }) => 'Day ' + day + ': ' + (record ? record.values[key] : 'no reading')).join('. ')) + '">' +
    daily.map(({ day, record }) => {
      const value = record?.values[key];
      return '<div class="mini-day"><span>' + (value ?? '—') + '</span><div class="mini-track">' +
        (value !== undefined ? '<div class="mini-bar" style="height:' + value / max * 100 + '%"></div>' : '<span class="mini-gap">—</span>') +
        '</div><small>D' + day + '</small></div>';
    }).join('') + '</div><p class="trend-note">Zero-based scale · — No reading</p></figure>';
}

function drawTrend(key) {
  const data = profile();
  const records = currentRecords(data.records).filter(record => record.values[key] !== undefined);
  $('#trend').innerHTML = '<p class="small muted">Daily latest values · Gaps stay unmeasured · ' + (key === 'sleep' && data.baseline ? escape(data.baseline.source) + ' ' + data.baseline.low + '–' + data.baseline.high + ' h · Sample count unavailable' : 'Personal reference unavailable') + '</p>' + trendChart(data, key) + '<div class="table-scroll"><table><caption>Source observations · ' + (metrics[key]?.unit || 'Self-report') + '</caption><thead><tr><th>Day / UTC</th><th>Value</th><th>Source & context</th></tr></thead><tbody>' + records.map(record => '<tr><td>D' + record.day + '<br>' + utc(record.time) + '</td><td>' + escape(record.values[key]) + ' ' + (metrics[key]?.unit || '') + '</td><td>' + escape(record.source) + '<br>' + escape(record.phase) + '<br>' + escape(record.context || 'Context not released') + '</td></tr>').join('') + '</tbody></table></div>' + (!records.length ? '<p>No observations for this indicator.</p>' : '');
}
$('#close-dialog').onclick = () => $('#dialog').close();
$('#help').onclick = () => modal('Crew medical help', '<div class="guidance"><h3>Contact the crew medical officer now for an urgent concern</h3><p>Use the mission’s approved communication and emergency procedure. This prototype has no loaded medical protocols and cannot call or transmit a distress message.</p></div><button id="urgent-report" class="danger-button wide">Record an urgent crew report</button>');
$('#dialog-body').addEventListener('click', event => { if (event.target.id === 'urgent-report') { $('#dialog').close(); report(); $('input[name=urgent]').checked = true; } });
$('#sources').onclick = () => modal('Research & scope', '<p>Based on the supplied challenge brief and agency resources. All 17 NASA risk categories have a destination in the system list. Specialized exams display their availability; this prototype does not infer a disease from routine vitals.</p><ul class="source-list">' + sources.map(([label, url]) => '<li><a target="_blank" rel="noreferrer" href="' + url + '">' + label + ' ↗</a></li>').join('') + '</ul><p class="small muted"><a href="assets/anatomy-ATTRIBUTION.md" target="_blank">BodyParts3D © DBCLS · Adapted by Open Anatomy 3D</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a><br>Layer colors and visibility modified · Male reference anatomy</p><p>The sleep comparison uses an explicitly fictional preflight reference. Real crew records require appropriate access controls and mission-approved protocols.</p>');
document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { location.hash = button.dataset.page; });
window.addEventListener('hashchange', () => {
  if (!['', '#home', '#home-workflows', '#home-scope', '#dashboard', '#profile', '#log'].includes(location.hash)) return;
  page = ['#dashboard', '#profile', '#log'].includes(location.hash) ? location.hash.slice(1) : 'home';
  render();
  $('#main').focus({ preventScroll: true });
  requestAnimationFrame(() => {
    const section = document.getElementById(location.hash.slice(1));
    if (section) section.scrollIntoView({ behavior: 'instant' });
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
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
