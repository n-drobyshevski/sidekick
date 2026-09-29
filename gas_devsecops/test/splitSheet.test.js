// The MTTR split's row sheet, the pure half (src/client/js/pages/_splitSheet.js): the requests a
// row sends, the registers its findings list offers, the columns and sorts each register may
// use, and the words round them — plus parity with the server constants it copies.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SPLIT_NONE, SPLIT_REGISTERS, splitBucketNote, splitCountNote, splitRowLabel,
  splitSheetColumnKeys, splitSheetDefaults, splitSheetFirstRegister, splitSheetRegisters,
  splitSheetRequests, splitSheetSortFor, splitSheetSubtitle,
} from "../src/client/js/pages/_splitSheet.js";
import { FINDING_COLUMNS } from "../src/client/js/pages/mttr.js";
import { REGISTER_ROW_COLUMNS } from "../src/domain/pagePayload";

const readModelsSrc = readFileSync(new URL("../src/server/readModels.ts", import.meta.url), "utf8");

describe("parity with the server", () => {
  it("spells the no-value bucket the way readModels does", () => {
    expect(readModelsSrc).toContain(`export const SPLIT_NONE = ${JSON.stringify(SPLIT_NONE)};`);
  });

  it("names only registers the server knows", () => {
    expect(SPLIT_REGISTERS.slice().sort()).toEqual(Object.keys(REGISTER_ROW_COLUMNS).sort());
  });
});

describe("the requests", () => {
  it("carries the bucket as a split, and the page's register only on the MTTR request", () => {
    const row = { group: "CS-ALPHA" };
    expect(splitSheetRequests("supportGroup", row, "sca")).toEqual({
      mttr: { groupBy: "supportGroup", groupValue: "CS-ALPHA", scope: "sca" },
      register: { split: { by: "supportGroup", value: "CS-ALPHA" } },
    });
    expect(splitSheetRequests("bogus", row, null).mttr).toEqual({ groupBy: "domain", groupValue: "CS-ALPHA" });
  });
});

describe("the registers", () => {
  const row = { totalByScope: { sca: 3, secrets: 1 }, openByScope: { secrets: 1 } };

  it("offers the registers the row has findings in, or the page's one", () => {
    expect(splitSheetRegisters(row, null)).toEqual(["sca", "secrets"]);
    expect(splitSheetRegisters(row, "sast")).toEqual(["sast"]);
    expect(splitSheetRegisters({}, null)).toEqual(SPLIT_REGISTERS);
  });

  it("opens on the first register with something open, on its open list", () => {
    expect(splitSheetFirstRegister(row, ["sca", "secrets"])).toBe("secrets");
    expect(splitSheetDefaults(row, "secrets")).toEqual({ status: "open", sort: "first_seen", dir: "asc" });
    expect(splitSheetDefaults(row, "sca")).toEqual({ status: "resolved", sort: "mttr_days", dir: "desc" });
  });

  it("only ever uses columns and sorts the register ships, and has a cell for each", () => {
    for (const reg of SPLIT_REGISTERS) {
      for (const dim of ["domain", "supportGroup", "repo"]) {
        for (const status of ["open", "resolved", "all"]) {
          const keys = splitSheetColumnKeys(reg, dim, status);
          for (const k of keys) {
            expect(REGISTER_ROW_COLUMNS[reg], `${reg} ${k}`).toContain(k);
            expect(FINDING_COLUMNS[k], k).toBeDefined();
          }
          expect(keys.includes("repo_name")).toBe(dim !== "repo");
          const { sort } = splitSheetSortFor(reg, status);
          expect(REGISTER_ROW_COLUMNS[reg], `${reg} sort ${sort}`).toContain(sort);
        }
      }
    }
  });
});

describe("the words", () => {
  it("names the counted domain once the payload says it", () => {
    const within = { kind: "project", value: "ce-transport", supportGroup: "CE-TRANSPORT" };
    expect(splitSheetSubtitle("repo", within, null, "SAP"))
      .toBe("Repository · in project ce-transport · support group CE-TRANSPORT · domain SAP");
    expect(splitSheetSubtitle("supportGroup", { kind: "domain", value: "CROSS" }, "sca"))
      .toBe("Support group · domain CROSS · Dependencies only");
    expect(splitSheetSubtitle("domain", null, null, "CROSS")).toBe("Domain");
  });

  it("explains the no-value bucket, and nothing else", () => {
    expect(splitBucketNote("domain", SPLIT_NONE)).toMatch(/no domain tag/);
    expect(splitBucketNote("supportGroup", SPLIT_NONE)).toMatch(/no support group/);
    expect(splitBucketNote("domain", "CROSS")).toBeNull();
  });

  it("flags an open list that disagrees with its row", () => {
    const row = { openByScope: { sca: 3 } };
    expect(splitCountNote(row, "sca", 3, "open")).toBeNull();
    expect(splitCountNote(row, "sca", 2, "open")).toMatch(/counts 3 open/);
    expect(splitCountNote(row, "sca", 2, "resolved")).toBeNull();
  });

  it("labels the row for a screen reader", () => {
    expect(splitRowLabel("repo", { group: "one" })).toBe("one, repository, open remediation and findings");
  });
});
