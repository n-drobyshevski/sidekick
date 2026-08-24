// The Wiz/Domain fold: what a domain is, and the promise that it is read rather than stored.
//
// The second half of this file is the one that matters. Resolving the domain on READ is a
// choice with a failure mode a unit test cannot see: the tag key is a Script Property, so
// nothing bumps DATA_VERSION when it changes, and every cached read-model would keep
// answering under the old key until the 6h TTL expired. That is invisible in the source and
// obvious in production, so it is pinned end-to-end through the real server.

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DOMAIN_TAG_KEY,
  domainCoverage,
  domainOfTags,
  resolveDomainTagKey,
} from "../src/domain/domainTag";
import { withDomains } from "../src/domain/graphEnrich";
import type { GNode } from "../src/domain/graphTypes";
import { bootServer, teardownServer } from "./gasEnv";

const t = (key: string, value: string) => ({ key, value });

describe("domainOfTags", () => {
  it("reads the tenant's own key", () => {
    expect(domainOfTags([t("Wiz/Domain", "CROSS")])).toBe("CROSS");
  });

  // The captures say `Wiz/Domain`; every human writing about it says `Wiz/domain`. An
  // operator who types the latter into the Script Property must not silently select nothing.
  it("matches the key case-insensitively, and tolerates surrounding space", () => {
    expect(domainOfTags([t("wiz/domain", "SAP")])).toBe("SAP");
    expect(domainOfTags([t("WIZ/DOMAIN", "SAP")])).toBe("SAP");
    expect(domainOfTags([t("  Wiz/Domain  ", "SAP")])).toBe("SAP");
    expect(domainOfTags([t("Wiz/Domain", "SAP")], "wiz/domain")).toBe("SAP");
  });

  // The value is a label a person chose. Folding its case would print something the Wiz
  // console does not.
  it("returns the value as written, only trimmed", () => {
    expect(domainOfTags([t("Wiz/Domain", "  EXAMPLE DOMAIN  ")])).toBe("EXAMPLE DOMAIN");
    expect(domainOfTags([t("Wiz/Domain", "Value-Chain")])).toBe("Value-Chain");
  });

  it("treats a blank value as no domain — an empty string is not an owner", () => {
    expect(domainOfTags([t("Wiz/Domain", "")])).toBeNull();
    expect(domainOfTags([t("Wiz/Domain", "   ")])).toBeNull();
  });

  it("is null for tags that do not include the key, and for no tags at all", () => {
    expect(domainOfTags([t("env", "prod")])).toBeNull();
    expect(domainOfTags([])).toBeNull();
    expect(domainOfTags(null)).toBeNull();
    expect(domainOfTags(undefined)).toBeNull();
  });

  it("honours a configured key other than the default", () => {
    const tags = [t("Wiz/Domain", "CROSS"), t("business-unit", "Payments")];
    expect(domainOfTags(tags, "business-unit")).toBe("Payments");
    expect(domainOfTags(tags, "   ")).toBeNull();
  });
});

describe("resolveDomainTagKey", () => {
  it("falls back to the default for anything blank", () => {
    expect(resolveDomainTagKey(null)).toBe(DEFAULT_DOMAIN_TAG_KEY);
    expect(resolveDomainTagKey("")).toBe(DEFAULT_DOMAIN_TAG_KEY);
    expect(resolveDomainTagKey("   ")).toBe(DEFAULT_DOMAIN_TAG_KEY);
    expect(resolveDomainTagKey("  business-unit ")).toBe("business-unit");
  });
});

describe("withDomains", () => {
  const node = (over: Partial<GNode>): GNode =>
    ({ id: "n", kind: "AI_AGENT", name: "n", ...over }) as GNode;

  it("attaches the domain, and leaves an untagged node's domain absent rather than empty", () => {
    const [tagged, untagged, noKey] = withDomains(
      [
        node({ id: "a", tags: [t("Wiz/Domain", "CROSS")] }),
        node({ id: "b" }),
        node({ id: "c", tags: [t("env", "prod")] }),
      ],
      DEFAULT_DOMAIN_TAG_KEY,
    );
    expect(tagged.domain).toBe("CROSS");
    // Absent, not "": a facet counts present values, and "" would be an option nobody named.
    expect("domain" in untagged).toBe(false);
    expect("domain" in noKey).toBe(false);
  });

  // An ISSUE node is evidence about an asset and owns no tags of its own. Saying "no domain"
  // about it would invite a reader to file it under Ungrouped, away from the asset it
  // describes — the graph's grouping layer inherits the parent's key instead.
  it("skips synthetic nodes", () => {
    const out = withDomains([node({ kind: "ISSUE", tags: [t("Wiz/Domain", "CROSS")] })], DEFAULT_DOMAIN_TAG_KEY);
    expect(out[0].domain).toBeUndefined();
  });
});

describe("domainCoverage", () => {
  it("counts how much of the landscape carries the tag", () => {
    expect(domainCoverage(
      [{ domain: "CROSS" }, { domain: null }, { domain: "SAP" }, {}],
      "Wiz/Domain",
    )).toEqual({ key: "Wiz/Domain", tagged: 2, total: 4 });
  });

  it("reports zero of zero rather than dividing by nothing", () => {
    expect(domainCoverage([], "Wiz/Domain")).toEqual({ key: "Wiz/Domain", tagged: 0, total: 0 });
  });
});

describe("the domain is read, not stored", () => {
  afterEach(() => teardownServer());

  // THE TRAP THIS FILE EXISTS FOR. WIZ_DOMAIN_TAG_KEY is a Script Property: it never passes
  // through settingsStore.saveSettings, so DATA_VERSION never bumps for it, so without the
  // config stamp in the cache key (serverCache.configStamp) and in derivedAssetsMemo, every
  // derived read-model would keep answering under the old key for the rest of the 6h TTL —
  // with no sync an operator could run to clear it.
  //
  // Changing the key mid-flight and re-reading is the only way to observe that, and it also
  // proves the value was never baked into ai_assets: nothing re-syncs here.
  it("picks up a changed tag key with no re-sync and no version bump", async () => {
    const server = await bootServer();
    server.setup();
    const sync = server.api.runSync({}) as { ok: boolean; error?: string };
    expect(sync.ok, sync.error).toBe(true);

    type Assets = { ok: boolean; data?: { rows?: Array<{ domain?: string | null }> } };
    const domainsOf = () =>
      ((server.api.getAssets({}) as Assets).data?.rows ?? [])
        .map((r) => r.domain)
        .filter(Boolean) as string[];

    const before = domainsOf();
    expect(before.length, "the dry-run seed must carry Wiz/Domain tags").toBeGreaterThan(0);

    // A key the seed spells on no resource: every domain must disappear.
    PropertiesService.getScriptProperties().setProperty("WIZ_DOMAIN_TAG_KEY", "no-such-tag");
    expect(domainsOf()).toEqual([]);

    // And back, without a sync in between.
    PropertiesService.getScriptProperties().setProperty("WIZ_DOMAIN_TAG_KEY", "wiz/domain");
    expect(domainsOf().sort()).toEqual(before.sort());
  });
});
