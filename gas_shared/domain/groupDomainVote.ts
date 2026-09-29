// WHICH ONE DOMAIN A SUPPORT GROUP COUNTS UNDER — the vote both registers take, in one copy.
//
// The OS register (gas/src/domain/currentDomain.ts) and the code register
// (gas_devsecops/src/domain/currentDomain.ts) each put every finding in ONE domain by the same
// three rules; only the words for an asset and the tails differ:
//
//   1. AN ASSET HAS ONE CURRENT DOMAIN — the one its NEWEST row resolves to (`resolveHead`,
//      called once per asset on a copy of that row after `annotateHeads` joined what it needs).
//   2. EVERY SUPPORT GROUP IS PINNED TO ONE DOMAIN — the one most of its CURRENT assets sit in
//      (an asset is current while it carries an open finding; with none, all its assets). A
//      group's assets are every asset any of its rows sits on — `groupOf` is read off EACH row,
//      never assumed from an asset's newest one: a host that moved between subscriptions keeps
//      its old findings in the old group, and a group that owned no asset's newest row used to
//      go unpinned and spread over several domains. Named domains outrank the tails (`isNamed`),
//      then more voting assets, then more of the group's findings, then the name.
//   3. AN ADMIN OVERRIDE WINS (`overrides`), even when it names the domain the vote chose — that
//      is how "in CROSS on purpose" is recorded — and holds for a group with no rows yet.
//
// TWO SWITCHES, because the registers' tails differ:
//
//   pinUnnamed               may a group be pinned to a tail? The OS register says yes — its
//                            Unassigned is a real, scoped bucket; a group of untagged hosts
//                            belongs in it. The code register says no — "no domain" is an
//                            UNSET `_domain` there, not a bucket, so a group whose repos carry
//                            no tag stays unpinned and each row keeps its repo's (empty) domain.
//   widenWhenNoNamedCurrent  when none of the group's CURRENT assets is tagged, widen the vote
//                            to all of them before giving up. The code register wants it (a
//                            team's live repos untagged, its archived ones tagged, still says
//                            where the team belongs); the OS register leaves it off, so its
//                            behaviour is byte-for-byte what #349 shipped.
//
// Pure, no GAS globals: both apps' tests pin it.

export interface GroupVoteSpec<R, D> {
  /** The asset a row sits on; "" when the ledger cannot identify one (compacted history). */
  keyOf: (r: R) => string;
  /** The row's own support group; "" for none. */
  groupOf: (r: R) => string;
  /** When the row was last seen, epoch ms (-Infinity when unknown) — picks each asset's head. */
  lastSeenMs: (r: R) => number;
  /** Whether the row is still open — decides which assets are "current". */
  isOpen: (r: R) => boolean;
  /** Attach, in place, whatever `resolveHead` reads — called ONCE with every asset's head COPY. */
  annotateHeads: (heads: R[]) => void;
  /** The domain an asset's head resolves to. */
  resolveHead: (head: R) => D;
  /** The domain a row with no asset identity resolves to (votes only for a group with no asset). */
  resolveKeyless: (r: R) => D;
  /** The domain's name. */
  nameOf: (d: D) => string;
  /** False for a tail — Unassigned / Not attributable, or "" where no domain is unset. */
  isNamed: (name: string) => boolean;
  pinUnnamed: boolean;
  widenWhenNoNamedCurrent: boolean;
}

export interface GroupDomainAssignment<D> {
  /** Support group → the one domain it counts under (absent: unpinned). */
  groupDomain: Map<string, string>;
  /** Support group → how that was decided. */
  groupSource: Map<string, "override" | "auto">;
  /** Asset key → its current domain. */
  assetDomain: Map<string, D>;
}

export function assignGroupDomains<R extends object, D>(
  rows: readonly R[],
  spec: GroupVoteSpec<R, D>,
  overrides: ReadonlyMap<string, string> = new Map(),
): GroupDomainAssignment<D> {
  const newest = new Map<string, R>();
  const openAssets = new Set<string>();
  // group → asset key → that asset's rows IN THIS GROUP (the tie-break weight).
  const groupAssets = new Map<string, Map<string, number>>();
  // group → rows with no asset identity, for a group that has nothing else to vote with.
  const groupKeyless = new Map<string, R[]>();
  for (const r of rows) {
    const key = spec.keyOf(r);
    const sg = spec.groupOf(r);
    if (key) {
      const prev = newest.get(key);
      if (!prev || spec.lastSeenMs(r) > spec.lastSeenMs(prev)) newest.set(key, r);
      if (spec.isOpen(r)) openAssets.add(key);
    }
    if (!sg) continue;
    if (key) {
      let m = groupAssets.get(sg);
      if (!m) groupAssets.set(sg, (m = new Map()));
      m.set(key, (m.get(key) ?? 0) + 1);
    } else {
      let list = groupKeyless.get(sg);
      if (!list) groupKeyless.set(sg, (list = []));
      list.push(r);
    }
  }

  const heads = [...newest.values()].map((r) => ({ ...r }));
  spec.annotateHeads(heads);
  const assetDomain = new Map<string, D>();
  [...newest.keys()].forEach((key, i) => assetDomain.set(key, spec.resolveHead(heads[i]!)));
  const nameOfAsset = (a: string) => spec.nameOf(assetDomain.get(a)!);

  const count = (names: string[]) => {
    const votes = new Map<string, number>();
    for (const d of names) {
      if (!spec.pinUnnamed && !spec.isNamed(d)) continue;
      votes.set(d, (votes.get(d) ?? 0) + 1);
    }
    return votes;
  };
  const pick = (votes: Map<string, number>, findings: Map<string, number>) => [...votes.entries()]
    .sort((x, y) =>
      Number(!spec.isNamed(x[0])) - Number(!spec.isNamed(y[0]))
      || y[1] - x[1]
      || (findings.get(y[0]) ?? 0) - (findings.get(x[0]) ?? 0)
      || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))[0]?.[0];

  const groupDomain = new Map<string, string>();
  for (const sg of new Set([...groupAssets.keys(), ...groupKeyless.keys()])) {
    const assets = groupAssets.get(sg) ?? new Map<string, number>();
    const findings = new Map<string, number>();
    let votes: Map<string, number>;
    if (assets.size) {
      const all = [...assets.keys()];
      const current = all.filter((a) => openAssets.has(a));
      votes = count((current.length ? current : all).map(nameOfAsset));
      if (spec.widenWhenNoNamedCurrent && current.length && current.length < all.length
        && ![...votes.keys()].some(spec.isNamed)) {
        votes = count(all.map(nameOfAsset));
      }
      for (const [a, n] of assets) {
        const d = nameOfAsset(a);
        findings.set(d, (findings.get(d) ?? 0) + n);
      }
    } else {
      votes = count((groupKeyless.get(sg) ?? []).map((r) => spec.nameOf(spec.resolveKeyless(r))));
    }
    const winner = pick(votes, findings);
    if (winner !== undefined) groupDomain.set(sg, winner);
  }

  const groupSource = new Map<string, "override" | "auto">();
  for (const sg of groupDomain.keys()) groupSource.set(sg, "auto");
  for (const [sg, domain] of overrides) {
    groupDomain.set(sg, domain);
    groupSource.set(sg, "override");
  }
  return { groupDomain, groupSource, assetDomain };
}
