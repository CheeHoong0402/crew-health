// Fictional software rules and cached guidance, separate from device observations.
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
