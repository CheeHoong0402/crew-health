// Fictional software rules and cached guidance, separate from device observations.
const concernProcedures = {
  sleep: ['Review sleep and rest', [
    'Compare recorded sleep with the available rest period.',
    'If the available period was also short, review the duty schedule with the responsible crew member. If more rest time was available, record interruptions.',
    'Agree on the next rest opportunity and record the next sleep check.'
  ]],
  support: ['Complete the crew check-in', [
    'Contact the requested support recipient.',
    'Discuss the concern privately and agree on the support or follow-up needed.',
    'Record the outcome and assign the next check if the concern remains open.'
  ]],
  heart: ['Review blood pressure and pulse', [
    'Record symptoms and the activity and posture at the time of the reading.',
    'Use the approved onboard measurement procedure to repeat the reading under comparable conditions.',
    'Review the result with the crew medical officer and record the agreed next check.'
  ]],
  abdomen: ['Review the glucose reading', [
    'Check the glucose unit and record meal timing and any symptoms.',
    'Follow the approved onboard procedure for confirming and responding to the reading.',
    'Record the response and arrange the next check with the crew medical officer.'
  ]],
  skin: ['Review temperature or immune concerns', [
    'Record symptoms and the method used to collect the reading.',
    'Repeat the measurement using the approved onboard procedure.',
    'Review the observations with the crew medical officer and record the next action.'
  ]],
  lungs: ['Respond to the breathing concern', [
    'Contact the crew medical officer immediately for an urgent breathing concern.',
    'Follow the approved onboard procedure for the reported activity and location.',
    'Record the actions taken, the response and who will perform the next assessment.'
  ]],
  kidneys: ['Review hydration concerns', [
    'Record fluid intake, the collection period and any reported symptoms.',
    'Check the available intake and urine observations with the crew medical officer.',
    'Record the agreed action and next assessment.'
  ]],
  operations: ['Review the cabin condition', [
    'Identify the affected compartment and the abnormal cabin measurement.',
    'Contact the responsible crew member and follow the approved environmental-control procedure.',
    'Record the action, the next cabin measurement and any reported symptoms.'
  ]],
  exposure: ['Review radiation exposure', [
    'Identify the affected astronaut, activity interval and recorded dose or dose rate.',
    'Contact the responsible crew member and follow the approved radiation-response procedure.',
    'Record the action and assign the next dosimeter review.'
  ]],
  head: ['Review balance or gravity-related symptoms', [
    'Record symptom onset, the gravity transition, posture and activity.',
    'Contact the crew medical officer and follow the approved balance-assessment procedure.',
    'Record the assessment result and assign the next check.'
  ]],
  limbs: ['Review muscle or limb concerns', [
    'Record the affected area, activity and reported symptoms.',
    'Review the measured strength or exercise result with the crew medical officer.',
    'Follow the approved assessment procedure and record the next action.'
  ]],
  spine: ['Review bone or spine concerns', [
    'Record the location of symptoms and the latest measured exam result.',
    'Review the observations with the crew medical officer using the approved assessment procedure.',
    'Record the agreed action and next assessment.'
  ]],
  eyes: ['Review vision changes', [
    'Record when the change was noticed and the affected eye or eyes.',
    'Contact the crew medical officer and follow the approved eye-assessment procedure.',
    'Record the measured result and arrange the next review.'
  ]],
  general: ['Review the reported concern', [
    'Contact the crew medical officer for the reported concern.',
    'Follow the approved onboard assessment procedure.',
    'Record the response and assign the next action.'
  ]]
};

export function procedureForConcern(finding) {
  const key = finding.id?.startsWith('mission-support-') ? 'support' : finding.system;
  const [title, steps] = concernProcedures[key] || concernProcedures.general;
  return { title, steps, version: 'demo-local-v2' };
}

export function guidanceQuestion(finding) {
  if (finding.restricted || finding.id?.startsWith('mission-support-')) return 'Crew member requests a private wellbeing check-in.';
  const label = finding.label || finding.text || 'Reported health concern';
  const range = finding.range;
  if (!range) return (finding.key === 'mood' ? 'Self-reported mood ' + finding.value : label).slice(0, 2000);
  if (finding.system === 'sleep' && range.unit === 'h') return 'Slept ' + range.value + ' hours';
  const quantity = { ppm: 'Cabin CO2', kPa: 'Cabin pressure', 'uSv': 'Personal radiation dose', 'uSv/h': 'Dosimeter dose rate',
    '°C': 'Body temperature' }[range.unit] || label;
  return (quantity + ' ' + range.value + ' ' + range.unit).slice(0, 2000);
}

export const deviceConfig = [
  {
    "record_type": "demo_procedure",
    "record_id": "PROC-RAD",
    "quality": "valid",
    "procedure_version": "demo-v1",
    "visibility": "crew",
    "text": "Training checklist only. Verify source and units; record symptoms; request crew medical officer review; assign repeat observation. Requires mission validation."
  },
  {
    "record_type": "demo_procedure",
    "record_id": "PROC-SLEEP",
    "quality": "valid",
    "procedure_version": "demo-v1",
    "visibility": "crew",
    "text": "Training checklist only. Verify source and units; record symptoms; request crew medical officer review; assign repeat observation. Requires mission validation."
  },
  {
    "record_type": "demo_procedure",
    "record_id": "PROC-CASE",
    "quality": "valid",
    "procedure_version": "demo-v1",
    "visibility": "crew",
    "text": "Training checklist only. Verify source and units; record symptoms; request crew medical officer review; assign repeat observation. Requires mission validation."
  },
  {
    "record_type": "demo_procedure",
    "record_id": "PROC-GRAV",
    "quality": "valid",
    "procedure_version": "demo-v1",
    "visibility": "crew",
    "text": "Training checklist only. Verify source and units; record symptoms; request crew medical officer review; assign repeat observation. Requires mission validation."
  },
  {
    "record_type": "demo_procedure",
    "record_id": "PROC-CABIN",
    "quality": "valid",
    "procedure_version": "demo-v1",
    "visibility": "crew",
    "text": "Training checklist only. Verify source and units; record symptoms; request crew medical officer review; assign repeat observation. Requires mission validation."
  },
  {
    "record_type": "demo_rule",
    "record_id": "RULE-RAD-DOSE",
    "quantity": "personal_dose_equivalent",
    "value": "20",
    "unit": "uSv",
    "quality": "valid",
    "procedure_id": "PROC-RAD",
    "procedure_version": "demo-v1",
    "rule_id": "DEMO-RAD-DOSE-v1",
    "comparison": ">",
    "window_seconds": "7200",
    "freshness_seconds": "300",
    "visibility": "crew",
    "text": "Fictional demonstration threshold requiring mission validation."
  },
  {
    "record_type": "demo_rule",
    "record_id": "RULE-RAD-RATE",
    "quantity": "personal_dose_equivalent_rate",
    "value": "5",
    "unit": "uSv/h",
    "quality": "valid",
    "procedure_id": "PROC-RAD",
    "procedure_version": "demo-v1",
    "rule_id": "DEMO-RAD-RATE-v1",
    "comparison": ">",
    "window_seconds": "600",
    "freshness_seconds": "300",
    "visibility": "crew",
    "text": "Fictional demonstration threshold requiring mission validation."
  },
  {
    "record_type": "demo_rule",
    "record_id": "RULE-CO2",
    "quantity": "co2",
    "value": "5000",
    "unit": "ppm",
    "quality": "valid",
    "procedure_id": "PROC-CABIN",
    "procedure_version": "demo-v1",
    "rule_id": "DEMO-CO2-v1",
    "comparison": ">",
    "window_seconds": "840",
    "freshness_seconds": "300",
    "visibility": "crew",
    "text": "Fictional demonstration threshold requiring mission validation."
  },
  {
    "record_type": "demo_rule",
    "record_id": "RULE-TEMP",
    "quantity": "cabin_temperature",
    "value": "28",
    "unit": "degC",
    "quality": "valid",
    "procedure_id": "PROC-CABIN",
    "procedure_version": "demo-v1",
    "rule_id": "DEMO-TEMP-v1",
    "comparison": ">",
    "window_seconds": "840",
    "freshness_seconds": "300",
    "visibility": "crew",
    "text": "Fictional demonstration threshold requiring mission validation."
  },
  {
    "record_type": "demo_rule",
    "record_id": "RULE-PRESSURE",
    "quantity": "cabin_pressure",
    "value": "98",
    "unit": "kPa",
    "quality": "valid",
    "procedure_id": "PROC-CABIN",
    "procedure_version": "demo-v1",
    "rule_id": "DEMO-PRESSURE-v1",
    "comparison": "<",
    "window_seconds": "840",
    "freshness_seconds": "300",
    "visibility": "crew",
    "text": "Fictional demonstration threshold requiring mission validation."
  }
];
