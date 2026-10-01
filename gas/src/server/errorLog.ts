// The recent-errors log, viewable in-app (Settings → Diagnostics) instead of only in the Apps
// Script execution log. The motivating case was a *silent* background failure (the post-scan
// support-group refresh only console.warn'd), which now leaves a durable trace.
//
// The implementation is shared with gas_devsecops (gas_shared/server/errorLog.ts, which holds
// the key, the caps and the record-once rule); this module binds it to this register's Script
// Properties and re-exports the same API, so call sites import from here as they always did.

import {
  createErrorLog,
  utf8ByteLength,
  type ErrorEntry,
} from "../../../gas_shared/server/errorLog";
import { deleteProp, getProp, setProp } from "./props";

// Bound lazily, through arrows: a spec that mocks ./props without one of these must not fail
// at this module's evaluation.
const log = createErrorLog({
  get: (key) => getProp(key),
  set: (key, value) => setProp(key, value),
  delete: (key) => deleteProp(key),
});

export const recentErrors = log.recentErrors;
export const recordError = log.recordError;
export const markRecorded = log.markRecorded;
export const clearErrors = log.clearErrors;
export { utf8ByteLength, type ErrorEntry };
