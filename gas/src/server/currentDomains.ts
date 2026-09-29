// The register's ONE answer to "which domain does this finding count under" — today's domain
// repartition, applied to history as well as to the backlog. The rules and why live in
// `domain/currentDomain.ts`; this is the server end: build the assignment once per cache stamp
// from the whole ledger, and hand every read path the same `domainOf`.
//
// EVERY PATH THAT PUTS A FINDING IN A DOMAIN GOES THROUGH HERE: the header scope
// (`api.scopedBaseRows`), every split and breakdown that labels rows `_domain`, the register's
// domain column and filter, the scoped-viewer fence and the current frame (`findings.ts`). One
// path left on the raw resolution would put the same finding in two domains on two pages.
// What stays raw, on purpose, is the ATTRIBUTION AUDIT — the tag-vs-rule coverage figures and
// rule health measure the tags and rules themselves, which is a question about inputs, not
// about where a finding is counted.
//
// Keyed on `currentStamp()`: its data version moves on every ledger write, settings save
// (domain rules) and support-group map change, and its tag segment follows the tag key.

import { assignedDomain, buildDomainAssignment, type AssignedDomain, type DomainAssignment } from "../domain/currentDomain";
import { compileDomains } from "../domain/domainRules";
import { resolveDomain } from "../domain/resolveDomain";
import { type Rec } from "../domain/util";
import { attachBizDomains, configuredDomainTagKey } from "./bizDomains";
import * as ledgerStore from "./ledgerStore";
import { currentStamp } from "./serverCache";
import * as settingsStore from "./settingsStore";
import { attachSupportGroups, supportGroupResolver } from "./supportGroups";

let memo: { stamp: string; assignment: DomainAssignment; resolveRow: (r: Rec) => ReturnType<typeof resolveDomain> } | undefined;

function current() {
  const stamp = currentStamp();
  if (!memo || memo.stamp !== stamp) {
    const t0 = Date.now();
    const compiled = compileDomains(settingsStore.getDomains().items);
    const tagKey = configuredDomainTagKey();
    const resolveRow = (r: Rec) => resolveDomain(r, compiled, tagKey);
    const assignment = buildDomainAssignment(
      // The memo itself, not copies: this pass only reads, and copies only the heads it annotates.
      ledgerStore.readBaseRows() as unknown as Rec[],
      supportGroupResolver(),
      (heads) => { attachSupportGroups(heads); attachBizDomains(heads); },
      resolveRow,
    );
    memo = { stamp, assignment, resolveRow };
    console.log(JSON.stringify({
      stage: "domainAssignment", assets: assignment.assetDomain.size,
      groups: assignment.groupDomain.size, ms: Date.now() - t0,
    }));
  }
  return memo;
}

/** The domain `r` counts under. `_supportGroup` must be attached (every caller already does). */
export function domainOf(r: Rec): string {
  const m = current();
  return assignedDomain(r, m.assignment, m.resolveRow).name;
}

/** `domainOf` with the rule that decided it — the row sheet's Domains section reads this. */
export function assignedDomainOf(r: Rec): AssignedDomain {
  const m = current();
  return assignedDomain(r, m.assignment, m.resolveRow);
}

/** The whole assignment, for the one view that shows it rather than applying it. */
export function domainAssignment(): DomainAssignment {
  return current().assignment;
}
