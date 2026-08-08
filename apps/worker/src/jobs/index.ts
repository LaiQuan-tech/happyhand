/**
 * Job 清單。新增排程工作只要在這裡加一筆。
 */

import type { JobDefinition } from "../lib/runner.js";
import { atmReconciliationJob } from "./atm-reconciliation.js";
import { healthJob } from "./health.js";
import { reclaimSeatHoldsJob } from "./reclaim-seat-holds.js";
import { workshopRemindersJob } from "./workshop-reminders.js";

export const jobs: readonly JobDefinition[] = [
  reclaimSeatHoldsJob,
  workshopRemindersJob,
  atmReconciliationJob,
  healthJob,
];

export {
  atmReconciliationJob,
  healthJob,
  reclaimSeatHoldsJob,
  workshopRemindersJob,
};
