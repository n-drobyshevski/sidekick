// The trigger schedule setup() installs.
//
// Almost none of this can be observed in production: a GAS ClockTrigger exposes its handler
// function and nothing else — no hour, no minute, no timezone. The dev shim records the
// builder arguments precisely so this file can exist, which is the only reason a schedule can
// be asserted rather than hoped for. See the note above `newTrigger` in dev/gas-shims.js.

import { afterEach, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";

interface FakeTrigger {
  getHandlerFunction(): string;
  __schedule: Record<string, unknown>;
}

function triggers(handler: string): FakeTrigger[] {
  return (ScriptApp.getProjectTriggers() as unknown as FakeTrigger[])
    .filter((t) => t.getHandlerFunction() === handler);
}

const WARM = "trigger_warmReadModels";

describe("setup() installs the warm schedule", () => {
  afterEach(() => teardownServer());

  it("installs one trigger per ready-by hour, an hour early, near the half hour", async () => {
    const server = await bootServer();
    server.setup();

    const warm = triggers(WARM);
    expect(warm).toHaveLength(3);

    // 9/13/17 are the hours the warm must be FINISHED by; atHour(h) fires between h and h+1,
    // so each is scheduled an hour earlier. A trigger named for the hour it serves would hand
    // the 09:00 arrival exactly the cold load it exists to prevent.
    expect(warm.map((t) => t.__schedule["atHour"]).sort((a, b) => Number(a) - Number(b)))
      .toEqual([8, 12, 16]);

    for (const t of warm) {
      expect(t.__schedule["everyDays"]).toBe(1);
      // Narrows GAS's hour-wide window to +/-15 minutes, so a pass finishes before the hour.
      expect(t.__schedule["nearMinute"]).toBe(30);
      // Pinned, not inherited: a project re-created with `clasp create` gets the CLI's
      // default timezone, which would move the whole schedule to another continent.
      expect(t.__schedule["inTimezone"]).toBe("Europe/Paris");
    }
  });

  it("leaves gaps under the six-hour CacheService ceiling across the working day", async () => {
    const server = await bootServer();
    server.setup();
    const hours = triggers(WARM)
      .map((t) => Number(t.__schedule["atHour"]))
      .sort((a, b) => a - b);
    for (let i = 1; i < hours.length; i++) {
      expect(hours[i]! - hours[i - 1]!).toBeLessThan(6);
    }
  });

  it("is a no-op on a second run", async () => {
    const server = await bootServer();
    server.setup();
    const before = ScriptApp.getProjectTriggers().length;
    server.setup();
    expect(ScriptApp.getProjectTriggers().length).toBe(before);
    expect(triggers(WARM)).toHaveLength(3);
  });

  // THE CASE "INSTALL WHEN NONE EXIST" CANNOT HANDLE, and the reason the signature property
  // exists at all. A deployment predating this carries warm triggers on some older schedule,
  // and nothing on a Trigger can tell them apart from correct ones.
  it("rebuilds the set when the recorded schedule disagrees with the source", async () => {
    const server = await bootServer();
    server.setup();
    const props = PropertiesService.getScriptProperties();

    props.setProperty("WARM_TRIGGER_SCHEDULE", "Etc/UTC|1,5,9,13,17,21@0");
    const out = server.setup();

    expect(out).toMatch(/replaced 3/);
    const warm = triggers(WARM);
    expect(warm).toHaveLength(3);
    expect(warm.map((t) => t.__schedule["atHour"]).sort((a, b) => Number(a) - Number(b)))
      .toEqual([8, 12, 16]);
    expect(props.getProperty("WARM_TRIGGER_SCHEDULE")).toBe("Europe/Paris|8,12,16@30");
  });

  it("rebuilds when the property is missing entirely, as on an older deployment", async () => {
    const server = await bootServer();
    server.setup();
    PropertiesService.getScriptProperties().deleteProperty("WARM_TRIGGER_SCHEDULE");
    server.setup();
    expect(triggers(WARM)).toHaveLength(3);
    expect(PropertiesService.getScriptProperties().getProperty("WARM_TRIGGER_SCHEDULE"))
      .toBe("Europe/Paris|8,12,16@30");
  });

  it("does not disturb the daily sync trigger while rebuilding the warm set", async () => {
    const server = await bootServer();
    server.setup();
    const daily = triggers("trigger_dailySync");
    expect(daily).toHaveLength(1);

    PropertiesService.getScriptProperties().setProperty("WARM_TRIGGER_SCHEDULE", "stale");
    server.setup();

    const after = triggers("trigger_dailySync");
    expect(after).toHaveLength(1);
    // Still the daily sync's own schedule, in the script timezone rather than UTC.
    expect(after[0]!.__schedule["atHour"]).toBe(5);
  });
});
