// Identity hygiene: MFA and dormancy, which Wiz reports as RULES rather than as properties.
//
// This app said the opposite until the rule catalogue landed. The Wiz Scans page read "MFA is
// still not collected: Wiz reports it for human identities sourced from a connected IdP, and
// every identity in this estate's AI paths is a cloud service account or role, which has
// none." The first half is wrong. `cloudConfigurationRules` carries, against
// `subjectEntityType: USER_ACCOUNT`:
//
//   IAM-159  User should have MFA enabled
//   IAM-048  User with a console password should have MFA enabled
//   IAM-208  User with password-based authentication should have MFA enabled
//   IAM-235  User should not be inactive for more than 90 days
//   IAM-291  User should have recent login activity
//
// So it is reachable through `configurationFindings` — the root CONFIG_FINDINGS already uses —
// and joined to `humanAccess.identityIds` it answers the question that matters: not "how many
// people lack MFA", which is an IAM problem, but "how many of the people who can reach an AI
// agent lack MFA", which is this app's.
//
// WHY MATCHERS AND NOT AN ID LIST. There are at least three MFA rules in one tenant's
// catalogue and they are cloud-specific — a hardcoded triple would silently under-report on an
// estate with a different cloud mix, and silence is the failure mode this codebase spends the
// most effort refusing. Matching over the SYNCED catalogue re-resolves on every sync and can
// find a rule nobody thought of.
//
// It is still a heuristic over rule NAMES, and it is treated as one: the resolved set is
// persisted and listed in the Wiz Scans panel, so a wrong match or an empty one is visible
// rather than silent, and an empty match degrades the area instead of reporting zero findings.

import type { ConfigRuleRow, HygieneKind } from "./graphTypes";

/** The identity kind these rules are evaluated against, in Wiz's own subject vocabulary. */
export const HYGIENE_SUBJECT = "USER_ACCOUNT";

interface HygieneMatcher {
  kind: HygieneKind;
  /** Matched against the rule's NAME. Anchored on the phrasing Wiz's catalogue actually uses. */
  test: RegExp;
}

/**
 * Ordered, first match wins — a rule cannot be both, and MFA is tried first because
 * "User with a console password should have MFA enabled" contains neither dormancy phrase but
 * a future rule might contain both.
 */
const MATCHERS: readonly HygieneMatcher[] = [
  // "multi-factor authentication (MFA)" and bare "MFA enabled" both appear in the catalogue.
  { kind: "MFA", test: /multi-factor|\bMFA\b/i },
  // "should not be inactive for more than 90 days" and "should have recent login activity".
  // Deliberately NOT a bare /inactive/ — "Uninstalled Connected App should not be inactive"
  // is a SERVICE_ACCOUNT rule about an app, and the subject guard below already excludes it,
  // but the phrase is specific enough not to lean on that alone.
  { kind: "DORMANT", test: /inactive for more than|recent login activity/i },
];

/**
 * Which hygiene concern a catalogue rule speaks to, or null.
 *
 * The subject guard is not decoration. `IDP-012 "WorkSpaces Directory should have multi-factor
 * authentication enabled"` matches the MFA pattern and is evaluated against an
 * IDENTITY_PROVIDER — a real finding, and not one that says anything about whether a PERSON
 * has MFA. Collecting it would put a directory's misconfiguration in a count captioned
 * "identities with AI access lacking MFA".
 */
export function hygieneKindOf(rule: ConfigRuleRow): HygieneKind | null {
  if (rule.subjectEntityType !== HYGIENE_SUBJECT) return null;
  for (const m of MATCHERS) {
    if (m.test.test(rule.name)) return m.kind;
  }
  return null;
}

/**
 * Every identity-hygiene rule in the catalogue, as `ruleId → kind`.
 *
 * Keyed by `id` because that is what the findings filter takes; `shortId` rides along in
 * `shortIds` for the panel, which shows an operator what was matched rather than asking them
 * to trust it.
 */
export function resolveHygieneRules(catalogue: readonly ConfigRuleRow[]): {
  byId: Record<string, HygieneKind>;
  ids: string[];
  shortIds: string[];
} {
  const byId: Record<string, HygieneKind> = {};
  const ids: string[] = [];
  const shortIds: string[] = [];
  for (const rule of catalogue) {
    const kind = hygieneKindOf(rule);
    if (!kind || !rule.id) continue;
    byId[rule.id] = kind;
    ids.push(rule.id);
    if (rule.shortId) shortIds.push(rule.shortId);
  }
  return { byId, ids, shortIds };
}
