export const metrics = {
  pulse: { label: 'Resting heart rate', unit: 'bpm', min: 1, max: 400, step: 1, help: 'Read the onboard monitor at rest. Record recent activity in context.' },
  systolic: { label: 'Systolic blood pressure', unit: 'mmHg', min: 1, max: 400, step: 1, help: 'Use the mission cuff procedure. Record both pressure values.' },
  diastolic: { label: 'Diastolic blood pressure', unit: 'mmHg', min: 1, max: 400, step: 1, help: 'Keep posture and cuff conditions consistent for comparisons.' },
  temperature: { label: 'Body temperature', unit: '°C', min: 1, max: 60, step: 0.1, help: 'Record thermometer method in context. A temperature is one observation.' },
  sleep: { label: 'Sleep', unit: 'h', min: 0, max: 24, step: 0.1, help: 'Total sleep in the preceding 24 hours, including naps.' },
  glucose: { label: 'Blood glucose', unit: 'mg/dL', min: 1, max: 2000, step: 1, help: 'Only enter an obtained measurement. Record meal timing in context.' }
};
export const sources = [
  ['NASA · Five hazards', 'https://www.nasa.gov/hrp/hazards/'],
  ['NASA · Human spaceflight risks', 'https://www.nasa.gov/hrp/risks/'],
  ['NASA · Ongoing HRP research', 'https://www.nasa.gov/hrp/ongoing-hrp-research/'],
  ['CSA · Radiation instruments', 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp'],
  ['CSA · Science in space', 'https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp'],
  ['CSA · Body infographic', 'https://www.asc-csa.gc.ca/eng/multimedia/search/image/8056']
];
export const systems = [
  { id: 'heart', label: 'Heart & circulation', marker: [55, 24], back: [49, 29], keys: ['pulse', 'systolic', 'diastolic'], risks: ['Cardiovascular adaptation and events', 'Venous flow and coagulation changes', 'Vascular stiffness'], evidence: 'Pulse and cuff pressure describe the observation. Blood flow, clotting and vessel changes need the relevant exam.' },
  { id: 'eyes', label: 'Eyes & vision', marker: [50, 7], back: [50, 9], keys: [], risks: ['Spaceflight-associated neuro-ocular syndrome (SANS)', 'Cataracts'], evidence: 'Record vision changes and link an eye exam or retinal imaging for qualified review. SANS and cataracts require individual assessment.' },
  { id: 'head', label: 'Head & balance', marker: [45, 10], back: [46, 14], keys: [], risks: ['Sensorimotor and vestibular impairment', 'Motion sickness, disorientation and impaired balance', 'Radiation effects on cognition and movement'], evidence: 'Record dizziness, gait or coordination changes and the gravity transition. A timed task or clinical exam supplies additional evidence.' },
  { id: 'lungs', label: 'Chest & breathing', marker: [44, 26], back: [44, 26], keys: [], risks: ['Hypoxia', 'Decompression sickness', 'Spacewalk injury and impaired performance'], evidence: 'Personal oxygen saturation, suit oxygen and cabin pressure are different measurements. Preserve instrument, time and location.' },
  { id: 'abdomen', label: 'Nutrition & metabolism', marker: [50, 42], back: [50, 42], keys: ['glucose'], risks: ['Inadequate food and nutrition', 'Insulin resistance and type 2 diabetes'], evidence: 'Record intake, missed meals, appetite and glucose meal timing. One glucose reading cannot establish nutritional adequacy or diabetes.' },
  { id: 'kidneys', label: 'Kidneys & hydration', marker: [43, 39], back: [43, 39], keys: [], risks: ['Dehydration', 'Kidney stones and calcium excretion'], evidence: 'Record fluid intake and symptoms. Urine tests and imaging need a verified specimen or exam record.' },
  { id: 'spine', label: 'Spine & bones', marker: [50, 53], back: [50, 38], keys: [], risks: ['Spaceflight-induced bone changes', 'Bone fragility and fractures', 'Spinal changes and landing injury'], evidence: 'A bone-density study or spinal scan supplies direct evidence. Time in microgravity does not measure individual bone loss.' },
  { id: 'limbs', label: 'Muscles & limbs', marker: [46, 68], back: [46, 68], keys: [], risks: ['Reduced cardiorespiratory and musculoskeletal fitness', 'Loss of muscle mass and strength', 'Injury from dynamic loads'], evidence: 'Compare exercise workload, performance and recovery under similar conditions. Record injury site and event time.' },
  { id: 'skin', label: 'Skin, blood & immunity', marker: [30, 40], back: [30, 40], keys: ['temperature'], risks: ['Altered immune response and viral reactivation', 'Host-microorganism interactions', 'Rashes, allergies and infection susceptibility', 'Anemia and low white blood cell count'], evidence: 'Temperature and symptoms need context. Blood counts, immune biomarkers and microbiological results require dated specimen records.' },
  { id: 'sleep', label: 'Sleep & wellbeing', keys: ['sleep', 'mood'], risks: ['Sleep loss and irregular schedules', 'Behavioral changes and psychiatric disorders', 'Inadequate teamwork'], evidence: 'Sleep and mood are self-reports. Preserve shift context and restrict private notes. A qualified assessment is needed to establish a disorder.' },
  { id: 'exposure', label: 'Radiation exposure', keys: [], risks: ['Radiation-induced cancers', 'DNA damage and central nervous system injury', 'Neutron radiation exposure'], evidence: 'No personal dosimeter reading available. Keep personal exposure separate from compartment measurements; retain quantity, units and interval.' },
  { id: 'operations', label: 'Mission & habitat', keys: [], risks: ['Inadequate systems operations support', 'Spacewalk injury and performance', 'Landing injury and gravity transitions'], evidence: 'Record pressure, oxygen, carbon dioxide, noise, lighting, temperature and microbial sampling when available. Keep cabin, suit and personal sources distinct.' }
];
export function freshProfile(demo) {
  const records = demo ? [
    { id: 'demo-41', day: 41, time: '2026-11-13T08:10:00.000Z', phase: 'Transit', source: 'Crew entry', values: { sleep: 5.5 }, context: 'Shift changed', note: '' },
    { id: 'demo-42', day: 42, time: '2026-11-14T08:10:00.000Z', phase: 'Transit', source: 'Crew entry', values: { pulse: 64, systolic: 118, diastolic: 76, temperature: 36.7, sleep: 5, mood: 'Good' }, context: 'At rest; onboard cuff; oral thermometer. Shift changed.', note: '' }
  ] : [];
  return { day: 42, phase: 'Transit', baseline: demo ? { low: 7, high: 8, source: 'Fictional preflight reference', count: null } : null, records, events: demo ? [{ id: 'demo-event', system: 'lungs', time: '2026-11-14T14:12:00.000Z', day: 42, urgent: true, text: 'Breathing concern during spacewalk', owner: 'Crew medical officer', outcome: '', acknowledged: '' }] : [], followups: [], handoff: null, reviews: [] };
}
export function currentRecords(records) {
  const replaced = new Set(records.map(record => record.replaces).filter(Boolean));
  return records.filter(record => !record.retired && !replaced.has(record.id)).sort((a, b) => a.time.localeCompare(b.time));
}
export function latest(records, key) {
  return currentRecords(records).filter(record => record.values[key] !== undefined).at(-1);
}
export function sleepFlag(profile) {
  if (!profile.baseline) return null;
  const byDay = new Map();
  for (const record of currentRecords(profile.records)) {
    if (record.values.sleep !== undefined) byDay.set(record.day, record);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const day = days.at(-1);
  const previous = byDay.get(day - 1);
  const current = byDay.get(day);
  if (previous && current && current.day === profile.day && previous.values.sleep < profile.baseline.low && current.values.sleep < profile.baseline.low) return { previous, current };
  return null;
}
export function validateRecord(record) {
  if (!Number.isInteger(record.day) || record.day < 1 || record.day > 10000) throw Error('Mission day must be a whole number from 1 to 10000.');
  if (!record.time || Number.isNaN(Date.parse(record.time))) throw Error('Enter a valid measurement time.');
  if (!['Preflight', 'Transit', 'Surface', 'Re-entry', 'Recovery'].includes(record.phase)) throw Error('Choose a mission phase.');
  if (!record.values || typeof record.values !== 'object') throw Error('Measurements are missing.');
  for (const [key, value] of Object.entries(record.values)) {
    if (key === 'mood') {
      if (!['Very low', 'Low', 'Neutral', 'Good', 'Very good'].includes(value)) throw Error('Choose a valid mood.');
    } else {
      const field = metrics[key];
      if (!field || !Number.isFinite(value) || value < field.min || value > field.max) throw Error('Check the value for ' + (field?.label || key) + '.');
    }
  }
  if ((record.values.systolic === undefined) !== (record.values.diastolic === undefined)) throw Error('Enter both blood pressure values, or leave both blank.');
  if (record.values.systolic !== undefined && record.values.systolic < record.values.diastolic) throw Error('Systolic pressure must be at least diastolic pressure.');
  if (!Object.keys(record.values).length) throw Error('Enter at least one obtained reading.');
}
export function validatePersonal(personal) {
  for (const [key, limit] of Object.entries({ name: 100, astronautId: 40, missionName: 100, crewRole: 100 })) {
    if (typeof personal[key] !== 'string' || personal[key].length > limit) throw Error('Check the personal information field ' + key + '.');
  }
  for (const key of ['heightCm', 'weightKg']) {
    if (personal[key] !== '' && (!Number.isFinite(Number(personal[key])) || Number(personal[key]) <= 0 || Number(personal[key]) > 1000)) throw Error('Enter a positive height or body mass up to 1000.');
  }
  if (personal.bloodGroup && !['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(personal.bloodGroup)) throw Error('Choose a valid blood group.');
  if (personal.dateOfBirth) {
    const date = new Date(personal.dateOfBirth + 'T00:00:00Z');
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== personal.dateOfBirth || personal.dateOfBirth > new Date().toISOString().slice(0, 10)) throw Error('Enter a valid date of birth up to today.');
  }
}

export function updateEvent(event, action, text, time) {
  const note = text.trim();
  if (action === 'close' && !note) throw Error('Record an outcome before closing.');
  event.acknowledged = time;
  event.actions ||= [];
  event.actions.push({ time, text: note, action });
  if (action === 'close') event.outcome = note;
}

export function openRegionEvents(profile, systemId) {
  return profile.events.filter(event => event.system === systemId && !event.outcome);
}

export const demoRules = {
  pulse: { low: 50, high: 100, system: 'heart' },
  systolic: { low: 90, high: 140, system: 'heart' },
  diastolic: { low: 60, high: 90, system: 'heart' },
  temperature: { low: 36, high: 37.5, system: 'skin' },
  glucose: { low: 70, high: 140, system: 'abdomen' },
  sleep: { low: 7, high: 9, system: 'sleep' },
  mood: { system: 'sleep' }
};

export function gaugeScale(value, low, high) {
  if (!Number.isFinite(value) || (low == null && high == null) ||
      (low != null && !Number.isFinite(low)) || (high != null && !Number.isFinite(high)) ||
      (low != null && high != null && low >= high)) return null;
  const span = low != null && high != null ? high - low : Math.max(Math.abs(low ?? high) * 0.25, 1);
  const min = Math.min(value - span * 0.2, (low ?? high - span) - span * 0.5);
  const max = Math.max(value + span * 0.2, (high ?? low + span) + span * 0.5);
  const position = number => (number - min) / (max - min);
  return { min, max, position: position(value), start: low == null ? 0 : position(low),
    end: high == null ? 1 : position(high),
    deviation: low != null && value < low ? value - low : high != null && value > high ? value - high : 0 };
}

export function readingFindings(profile) {
  return Object.entries(demoRules).flatMap(([key, rule]) => {
    const record = latest(profile.records, key);
    if (!record) return [];
    const value = record.values[key];
    const low = key === 'sleep' ? profile.baseline?.low ?? rule.low : rule.low;
    const high = key === 'sleep' ? profile.baseline?.high ?? rule.high : rule.high;
    const outside = key === 'mood' ? ['Low', 'Very low'].includes(value) : value < low || value > high;
    if (!outside) return [];
    const id = 'reading-' + record.id + '-' + key;
    const review = (profile.reviews || []).find(item => item.findingId === id);
    return [{
      id, key, system: rule.system, record, value,
      reference: key === 'mood' ? 'Low or Very low requests a wellbeing review' : low + '–' + high + ' ' + metrics[key].unit + ' (inclusive)',
      label: (metrics[key]?.label || 'Mood') + ' needs review',
      review, rule: 'Demo reading rule v1',
      range: key === 'mood' ? null : { value, low, high, unit: metrics[key].unit }
    }];
  });
}

export function addObservation(profile, record) {
  validateRecord(record);
  if (record.replaces && profile.records.some(item => item.replaces === record.replaces)) throw Error('This entry already has a correction. Open the latest entry.');
  profile.records.push(record);
  if (record.day > profile.day) {
    profile.day = record.day;
    profile.phase = record.phase;
  }
}

export function reviewFinding(profile, findingId, note, time) {
  if (!note.trim()) throw Error('Record the action taken or the next step.');
  const finding = readingFindings(profile).find(item => item.id === findingId);
  if (!finding) throw Error('The source observation changed. Reopen the current finding.');
  profile.reviews ||= [];
  const existing = profile.reviews.find(item => item.findingId === findingId);
  const action = { time, note: note.trim() };
  if (existing) existing.actions.push(action);
  else profile.reviews.push({ findingId, label: finding.label, sourceId: finding.record.id, actions: [action] });
}

export function sevenDayReadings(profile, key) {
  const byDay = new Map();
  for (const record of currentRecords(profile.records)) {
    if (record.values[key] !== undefined) byDay.set(record.day, record);
  }
  return Array.from({ length: Math.min(7, profile.day) }, (_, index) => {
    const day = Math.max(1, profile.day - 6) + index;
    return { day, record: byDay.get(day) };
  });
}

export function systemMeasurements(records, systemId, astronautId) {
  const replaced = new Set(records.map(row => row.replaces_id).filter(Boolean));
  return records.filter(row => (!row.astronaut_id || row.astronaut_id === astronautId) &&
    row.body_system === systemId && !replaced.has(row.record_id) && row.quality === 'valid' &&
    ['measurement', 'assessment_result', 'lab_result', 'exercise', 'wellbeing'].includes(row.record_type) &&
    row.quantity && row.value !== '').sort((a, b) => (a.timestamp_utc || a.interval_end_utc).localeCompare(b.timestamp_utc || b.interval_end_utc));
}
