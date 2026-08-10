/**
 * Job 清單。新增排程工作只要在這裡加一筆。
 */

import type { JobDefinition } from "../lib/runner.js";
import { atmReconciliationJob } from "./atm-reconciliation.js";
import { backfillOrderUsersJob } from "./backfill-order-users.js";
import { flushEmailOutboxJob } from "./flush-email-outbox.js";
import { healthJob } from "./health.js";
import { reclaimSeatHoldsJob } from "./reclaim-seat-holds.js";
import { workshopRemindersJob } from "./workshop-reminders.js";

export const jobs: readonly JobDefinition[] = [
  reclaimSeatHoldsJob,
  flushEmailOutboxJob,
  backfillOrderUsersJob,
  workshopRemindersJob,
  atmReconciliationJob,
  healthJob,
];

export {
  atmReconciliationJob,
  backfillOrderUsersJob,
  flushEmailOutboxJob,
  healthJob,
  reclaimSeatHoldsJob,
  workshopRemindersJob,
};
