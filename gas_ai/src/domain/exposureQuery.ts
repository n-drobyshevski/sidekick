// Network exposure: the two traversals that answer "is this AI asset reachable from the
// internet", and the vocabulary the rest of the app judges their answers by.
//
// TWO QUESTIONS, NOT ONE. The Wiz console asks them as two separate graph queries and this
// module keeps them separate, because they make different claims:
//
//   HOST_EXPOSURE      AI asset <-RUNS- VIRTUAL_MACHINE / SERVERLESS [accessibleFrom.internet]
//                      "the compute under this asset is reachable from the internet."
//
//   ENDPOINT_EXPOSURE  AI asset -SERVES-> ENDPOINT [exposureLevel High|Medium, port Open]
//                      "Wiz's dynamic scanner connected to a live endpoint this asset
//                       serves, and policy rates it a real exposure."
//
// Collapsing them would be wrong, and the capture in exemples/ai_exposure_host_response.js
// is the proof: that agent's Cloud Run revision is `accessibleFrom.internet: true` and
// `openToAllInternet: true` — reachable — while both endpoints it serves come back
// `exposureLevel_name: "Low"`, matched by the rule "2XX HTTP status codes with SSO
// authentication". Reachable, and not a rated exposure. One asset, two true answers.
//
// WHY THIS RESOLVES ANYTHING. A hosted AI asset carries NO exposure flags of its own — the
// capture's AI_AGENT has no `accessibleFrom.*` key at all, which is why riskConditions.ts
// reports it UNDETERMINED and kpis.internetUnknown counts it. The reachability lives one hop
// away, on the compute. Until these queries existed there was nothing in the battery that
// could walk that hop, and `ai/queries/5_internet.md` was an empty file.

import { type SelectSpec } from "./graphExpand";

/**
 * The endpoint exposure levels that count as a validated exposure.
 *
 * Declared ONCE and read from both ends: `endpointExposureSpec` filters the query on it, and
 * `withExposureEvidence` (graphEnrich) tests the level Wiz actually returned against it. The
 * two must not drift — an endpoint that arrives through the OTHER query (host exposure
 * returns its applicationEndpoints unfiltered) is judged by this list rather than by which
 * query fetched it, which is the only reason a `Low`-rated endpoint cannot smuggle itself in
 * as a validated one.
 */
export const RATED_EXPOSURE_LEVELS = ["High", "Medium"] as const;

/** portValidationResult for a port Wiz's scanner actually connected to. */
export const VALIDATED_PORT_STATE = "Open";

/** The compute kinds an AI asset can be hosted on — the `RUNS` leg's far end. */
export const HOST_KINDS = ["VIRTUAL_MACHINE", "SERVERLESS"] as const;

/**
 * Host reachability: the compute that RUNS this AI asset, filtered to internet-reachable.
 *
 * `reverse: true` because Wiz's edge is `host -RUNS-> asset`; the graph model spells the
 * same fact `asset -HOSTED_ON-> host` (graphTypes.EDGE_TYPES), which is the direction
 * normalizeHostExposurePage emits.
 *
 * The type list is the TENANT-RESOLVED one (resolveAiResourceTypes), not the console's.
 * The two captures pass slightly different lists — the host query includes AI_DATASET and
 * AI_AGENT_REGISTRY, the endpoint query includes AI_GUARDRAIL — and that difference is an
 * artifact of whoever built them in the UI rather than a claim about which AI kinds can be
 * hosted. Using the resolved list keeps this consistent with INVENTORY_AI, which is the one
 * place the tenant's actual AI vocabulary is established.
 *
 * The console additionally sends `as: "scoped_entity"` on the root. That is a console-side
 * alias for referring to the node in its own UI and carries no meaning over the wire, so
 * toGraphEntityQuery does not render it.
 */
export function hostExposureSpec(types: readonly string[]): SelectSpec {
  return {
    type: [...types],
    relationships: [
      {
        type: [...HOST_KINDS],
        edge: { type: "RUNS", reverse: true },
        where: { "accessibleFrom.internet": { EQUALS: true } },
      },
    ],
  };
}

/**
 * Validated endpoint exposure: an ENDPOINT this AI asset SERVES that Wiz's dynamic scanner
 * found open AND policy rates High or Medium.
 *
 * Both halves of the filter matter and neither is redundant. `portValidationResult` is the
 * scanner's own "I connected"; `exposureLevel_name` is the tenant's exposure-level policy
 * verdict on what it found there. An open port behind SSO rates Low and is not an exposure;
 * a High-rated endpoint on a port that never answered is not one either.
 */
export function endpointExposureSpec(types: readonly string[]): SelectSpec {
  return {
    type: [...types],
    relationships: [
      {
        type: "ENDPOINT",
        edge: { type: "SERVES" },
        where: {
          exposureLevel_name: { EQUALS: [...RATED_EXPOSURE_LEVELS] },
          portValidationResult: { EQUALS: VALIDATED_PORT_STATE },
        },
      },
    ],
  };
}

/**
 * Whether a stored ENDPOINT node clears the validated-exposure bar.
 *
 * Reads the values Wiz returned, never the fact that a filtered query returned the row.
 * That distinction is load-bearing here in a way it is not for the other battery steps:
 * ENDPOINT nodes reach the ledger from TWO queries, and only one of them filtered.
 */
export function isRatedExposure(
  level: string | undefined,
  portValidation: string | undefined,
): boolean {
  if (portValidation !== VALIDATED_PORT_STATE) return false;
  return (RATED_EXPOSURE_LEVELS as readonly string[]).indexOf(level ?? "") >= 0;
}

/** The worse of two exposure levels, by the order in RATED_EXPOSURE_LEVELS (High first). */
export function worseExposureLevel(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  const rank = (v: string | undefined): number => {
    const i = (RATED_EXPOSURE_LEVELS as readonly string[]).indexOf(v ?? "");
    return i === -1 ? RATED_EXPOSURE_LEVELS.length : i;
  };
  if (a === undefined) return b;
  if (b === undefined) return a;
  return rank(a) <= rank(b) ? a : b;
}
