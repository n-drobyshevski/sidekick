// SUPPORT GROUP → DOMAIN OVERRIDES — the settings entry both registers keep, in one copy.
//
// An admin can set the one domain a support group counts under (the vote's rule 3,
// groupDomainVote.ts), with the reason it was set: "wrong_tag" corrects a group the vote put
// in the wrong domain, "cross_team" records a group that sits in CROSS on purpose because the
// CROSS team runs its assets — each register marks the two differently. Stored in the
// register's settings under `supportGroupDomains: { version, items }`; the version bumps on
// every write, as every other versioned setting's does.
//
// Pure, no GAS globals: both apps' tests pin it.

type Rec = Record<string, unknown>;

/** Why an admin set a support group's domain by hand. */
export const SG_DOMAIN_REASONS = ["wrong_tag", "cross_team"] as const;
export type SgDomainReason = (typeof SG_DOMAIN_REASONS)[number];

export interface SgDomainOverride {
  group: string;
  domain: string;
  reason: SgDomainReason;
  note: string;
  by: string;
  at: string;
}

/**
 * The admin overrides of a support group's domain (each register's currentDomains: an
 * override REPLACES the automatic pin). Cleaned on every read so a hand-edited blob can't inject junk:
 * group and domain trimmed and non-empty, the reason one of `SG_DOMAIN_REASONS`, ONE item per
 * group (the last one wins — the order a save appends in), sorted by group for a stable list.
 */
export function cleanSgDomainItems(items: unknown): SgDomainOverride[] {
  if (!Array.isArray(items)) return [];
  const byGroup = new Map<string, SgDomainOverride>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Rec;
    const group = String(r["group"] ?? "").trim();
    const domain = String(r["domain"] ?? "").trim();
    const reason = String(r["reason"] ?? "") as SgDomainReason;
    if (!group || !domain || !SG_DOMAIN_REASONS.includes(reason)) continue;
    byGroup.set(group, {
      group, domain, reason,
      note: String(r["note"] ?? "").trim().slice(0, 500),
      by: String(r["by"] ?? "").trim(),
      at: String(r["at"] ?? "").trim(),
    });
  }
  return [...byGroup.values()].sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0));
}

export function getSupportGroupDomains(settings: Rec): { version: number; items: SgDomainOverride[] } {
  const raw = settings["supportGroupDomains"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 0, items: [] };
  const r = raw as Rec;
  const v = Number(r["version"] ?? 0);
  return {
    version: Number.isFinite(v) ? Math.max(Math.trunc(v), 0) : 0,
    items: cleanSgDomainItems(r["items"]),
  };
}

export function withSupportGroupDomains<S extends object>(
  settings: S, items: unknown,
): S & { supportGroupDomains: { version: number; items: SgDomainOverride[] } } {
  const current = getSupportGroupDomains(settings as Rec);
  return {
    ...settings,
    supportGroupDomains: { version: current.version + 1, items: cleanSgDomainItems(items) },
  };
}
