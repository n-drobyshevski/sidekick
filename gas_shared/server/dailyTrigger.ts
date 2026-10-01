// The daily trigger reconcile — one standing ClockTrigger, at one hour of one timezone, kept
// in step with what the source (or a saved setting) asks for.
//
// ONE IMPLEMENTATION, TWO REGISTERS. gas_devsecops wrote it first (`setup.
// reconcileDailySyncTrigger`, its hour a saved setting); gas/ deduplicated its daily scan by
// handler name alone, with no timezone, so a deployment carrying a trigger from an earlier
// version (or two, after a setup() run as a second account) kept it forever. Each app's
// `src/server/setup.ts` now binds its handler, timezone, hour and Script Property in, and the
// contract both register is `gas_shared/test/contracts/dailyTrigger.js`.
//
// PROPERTY ACCESS IS INJECTED rather than imported, as `errorLog.ts` takes it: nothing under
// gas_shared/ reaches into an app's `props.ts`. `ScriptApp` is the platform global.
//
// WHY A SIGNATURE. A ClockTrigger exposes its handler function and NOTHING ELSE — no hour, no
// minute, no timezone — so `getProjectTriggers()` cannot tell a correctly-scheduled trigger
// from one installed by an earlier version of the schedule. The `${tz}|${hour}` string recorded
// beside it is the only way a changed hour (or a trigger from before the timezone was pinned)
// can be told apart from the one already installed.

/** What an app binds in: its handler, where it fires, and where the signature lives. */
export interface DailyTriggerSpec {
  /** The global function the trigger calls — dist/entry.js's `trigger_*`. */
  handler: string;
  /** IANA timezone the hour is read in — pinned with `.inTimezone`, never inherited. */
  tz: string;
  /** Hour of day, 0-23, in `tz`. */
  hour: number;
  /** The noun setup() prints, e.g. "Daily sync trigger". */
  label: string;
  /** The recorded signature (the app's Script Property), or null when none was ever written. */
  getSignature(): string | null;
  setSignature(signature: string): void;
}

/** The signature of a daily trigger at `hour` in `tz`: what is recorded beside it. */
export function dailyTriggerSignature(tz: string, hour: number): string {
  return `${tz}|${hour}`;
}

/**
 * Make the installed daily trigger fire at `spec.hour` (`spec.tz`), returning the line setup()
 * prints. A no-op when exactly one trigger exists under the handler and the recorded signature
 * already names this hour; otherwise one is created and every trigger previously under the
 * handler deleted — so duplicates collapse to one, and a trigger installed before the signature
 * existed (no property at all), which looks identical to a correct one, is replaced once and
 * the property written then is what makes every later run a no-op.
 *
 * CREATE BEFORE DELETE. A missed warm pass costs one cold page load; a daily trigger deleted
 * and then not recreated (quota, a transient ScriptApp error) stops the register refreshing at
 * all, silently. Created first, a failure leaves the old trigger firing at the old hour, which
 * deploymentDiagnostic() names; the list of old ones is read before the create, so the new
 * trigger is never in it.
 *
 * THE SIGNATURE IS WRITTEN LAST: a create() that throws leaves the property stale (or absent),
 * so the next setup() — or deploymentDiagnostic() — sees the mismatch instead of a schedule
 * recorded as installed that never was.
 *
 * THE TRIGGERS IT SEES ARE THE RUNNING ACCOUNT'S: `getProjectTriggers()` lists the current
 * user's triggers on this project only. Run setup() as the account the web app executes as
 * (`executeAs: USER_DEPLOYING`), or it installs a second daily trigger nothing else can see.
 */
export function reconcileDailyTrigger(spec: DailyTriggerSpec): string {
  const { handler, tz, hour, label } = spec;
  const existing = ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === handler);
  const want = dailyTriggerSignature(tz, hour);
  if (existing.length === 1 && spec.getSignature() === want) {
    return `${label}: already installed (${hour}:00 ${tz})`;
  }
  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .inTimezone(tz)
    .create();
  for (const t of existing) ScriptApp.deleteTrigger(t);
  spec.setSignature(want);
  return `${label}: installed (${hour}:00 ${tz})` +
    (existing.length ? ` (replaced ${existing.length})` : "");
}
