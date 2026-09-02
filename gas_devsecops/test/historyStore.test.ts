// historyStore: one ledger-stats snapshot per UTC day, latest wins.
//
// This is the Drive-backed analogue of gas/test/historyStore.test.ts (which pins the
// mttr_history Sheets tab's `recordSnapshot`/`loadHistory` pair) — ported in BEHAVIOUR rather
// than literally, because this register's historyStore stores an opaque `stats` object per
// UTC day under archiveStore's `history/` folder (see the target layout in archiveStore.ts)
// instead of named Sheets columns. What the gas test pins — a same-day write overwrites
// rather than accumulating, and history reads back sorted ascending by date — is exactly what
// `recordDaily`/`listHistory` are asserted against here.
//
// `test/gasEnv.ts` does not exist in this package yet (H1 lands it in parallel); this file
// evaluates dev/gas-shims.js itself, matching test/archiveStore.test.ts's boot() helper.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type HistoryStoreModule = typeof import("../src/server/historyStore");

async function boot(): Promise<HistoryStoreModule> {
  vi.resetModules();
  const g = globalThis as Record<string, unknown>;
  g["window"] = globalThis;
  runInThisContext(readFileSync(join(ROOT, "dev/gas-shims.js"), "utf8"), {
    filename: "dev/gas-shims.js",
  });
  const rootId = DriveApp.createFolder("archive-root").getId();
  PropertiesService.getScriptProperties().setProperty("ARCHIVE_FOLDER_ID", rootId);
  return import("../src/server/historyStore");
}

let store: HistoryStoreModule;

beforeEach(async () => {
  store = await boot();
});

const DAY1 = Date.parse("2026-03-01T09:00:00Z");
const DAY1_LATER = Date.parse("2026-03-01T21:30:00Z");
const DAY2 = Date.parse("2026-03-02T00:01:00Z");
const DAY3 = Date.parse("2026-03-03T12:00:00Z");

describe("recordDaily / listHistory", () => {
  it("listHistory is empty before anything is recorded", () => {
    expect(store.listHistory()).toEqual([]);
  });

  it("round-trips one day's stats verbatim", () => {
    store.recordDaily({ resolved: 10, open: 4, median_days: 1.5 }, DAY1);
    expect(store.listHistory()).toEqual([
      { date: "2026-03-01", stats: { resolved: 10, open: 4, median_days: 1.5 } },
    ]);
  });

  it("a second call the same UTC day overwrites, it does not append", () => {
    store.recordDaily({ resolved: 10, open: 4 }, DAY1);
    store.recordDaily({ resolved: 11, open: 3 }, DAY1_LATER);

    const rows = store.listHistory();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ date: "2026-03-01", stats: { resolved: 11, open: 3 } });
  });

  it("sorts ascending by date, independent of recording order", () => {
    store.recordDaily({ n: 3 }, DAY3);
    store.recordDaily({ n: 1 }, DAY1);
    store.recordDaily({ n: 2 }, DAY2);

    expect(store.listHistory().map((r) => r.date)).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
    ]);
    expect(store.listHistory().map((r) => (r.stats as { n: number }).n)).toEqual([1, 2, 3]);
  });

  it("the day boundary is UTC: 23:59 and next-day 00:01 land on different days", () => {
    store.recordDaily({ when: "late" }, Date.parse("2026-03-01T23:59:00Z"));
    store.recordDaily({ when: "early" }, Date.parse("2026-03-02T00:01:00Z"));

    expect(store.listHistory().map((r) => r.date)).toEqual(["2026-03-01", "2026-03-02"]);
  });

  it("defaults `now` to the current time when omitted", () => {
    const now = Date.parse("2026-03-05T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      store.recordDaily({ ok: true });
      expect(store.listHistory()).toEqual([{ date: "2026-03-05", stats: { ok: true } }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
