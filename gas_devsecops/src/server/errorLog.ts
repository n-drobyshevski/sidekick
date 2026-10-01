// The recent-errors log, viewable in-app (Data → Recent errors) instead of only in the Apps
// Script execution log.
//
// WHY THIS REGISTER NEEDS IT AS WELL AS THE `jobs` TAB. A failed sync leaves its message in
// the job row's `error` column, and `api.getRecentErrors` still reads that. Everything else
// that fails here does so SILENTLY: a read RPC that throws, the post-commit chores (history
// entry, auto-compaction, read-model warm), a durable read-model level that Drive refused, an
// unreadable repository-tag tab, a daily trigger that found no credentials. Each of those used
// to be a console.warn in an execution transcript nobody opens. A failed sync hop calls
// `markRecorded` instead, because its job row is already its record (scanJobs.ts).
//
// The implementation is shared with gas/ (gas_shared/server/errorLog.ts, which holds the key,
// the caps and the record-once rule); this module binds it to this register's Script
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
