// The asset/issue detail-sheet rail as pure data: which sections show, in what order,
// under which group, and whether each has anything to say. No DOM here, and nothing
// imported here touches one — this repo carries no jsdom and runs no DOM-level tests, so
// a rail bug is only catchable at all if the rail's own decisions live somewhere a plain
// Node process can run them. detailSheets.js paints what this module decides; it does no
// deciding of its own.

function section(id, label, group, count, empty) {
  return { id: id, label: label, group: group, count: count, empty: empty };
}

// ---------------------------------------------------------------------------- assets

/**
 * Rail sections for an asset record. "detail" is getAssetDetail's payload —
 * { node, issues, neighbors, findings } — with every part tolerated missing, since a
 * still-loading or partially-cached sheet must not throw while building its own table of
 * contents.
 */
export function assetSections(detail) {
  var d = detail || {};
  var node = d.node || {};
  var issues = d.issues || [];
  var neighbors = d.neighbors || [];
  var findings = d.findings || [];

  var issuesCount = issues.length;
  var findingsCount = findings.length;
  var comboCount = (node.comboGroups || []).length;
  var neighborsCount = neighbors.length;
  var tagsCount = (node.tags || []).length;

  // The exposure flags are tri-state: true, false, or null meaning "inherited from the
  // host, undetermined". A null is not evidence of exposure, so it reads as falsy here,
  // exactly like an explicit false — never treated as "set" just because it isn't undefined.
  var exposed = !!node.internet || !!node.openInternet || !!node.sensitiveData ||
    !!node.sensitiveAccess || !!node.highPriv || !!node.adminPriv;

  var hasProtectedByNeighbor = neighbors.some(function (n) {
    return !!(n && n.edge && n.edge.type === "PROTECTED_BY");
  });

  return [
    section("overview", "Overview", null, null, false),
    section("issues", "Issues", "Risk", issuesCount, issuesCount === 0),
    section("compliance", "Compliance", "Risk", findingsCount, findingsCount === 0),
    section("combos", "Toxic combinations", "Risk", comboCount, comboCount === 0),
    section("aars", "AARS breakdown", "Posture", null, !node.aarsPillars),
    section("exposure", "Exposure", "Posture", null, !exposed),
    section(
      "guardrails", "Guardrails", "Posture", null,
      !node.guardrailMissing && !hasProtectedByNeighbor,
    ),
    section("relationships", "Relationships", "Context", neighborsCount, neighborsCount === 0),
    section("identity", "Identity", "Context", null, !node.kind),
    section("tags", "Tags", "Context", tagsCount, tagsCount === 0),
  ];
}

// ---------------------------------------------------------------------------- issues

var FRAMEWORK_KEYS = ["owaspLlm", "owaspAgentic", "owaspMl", "fiveRs"];

/** Total codes mapped across all four framework buckets — 0 when none are set. */
function frameworkCodeCount(frameworks) {
  if (!frameworks) return 0;
  var total = 0;
  for (var i = 0; i < FRAMEWORK_KEYS.length; i++) {
    var codes = frameworks[FRAMEWORK_KEYS[i]];
    if (codes && codes.length) total += codes.length;
  }
  return total;
}

/**
 * Rail sections for an issue record. "detail" is getIssueDetail's payload —
 * { issue, group } — tolerated missing. Emptiness mirrors what openIssueSheet
 * (detailSheets.js) actually decides to append; this is that same decision made once,
 * reusable by any surface that wants a table of contents instead of one scrolling sheet.
 */
export function issueSections(detail) {
  var d = detail || {};
  var issue = d.issue || {};

  var fix = issue.remediation || issue.resolutionRecommendation;
  var ticketCount = (issue.ticketUrls || []).length;
  var accepted = issue.ignoreNote || issue.ignoreExpiredAt;
  var fwCount = frameworkCodeCount(issue.frameworks);

  return [
    section("overview", "Overview", null, null, false),
    section("fix", "Recommended fix", "Remediation", null, !fix),
    section("tickets", "Tickets", "Remediation", ticketCount, ticketCount === 0),
    section("accepted", "Accepted risk", "Remediation", null, !accepted),
    section("frameworks", "Framework mappings", "Context", fwCount, fwCount === 0),
    section("ai", "Wiz AI analysis", "Context", null, !issue.aiVerdict),
    section("facts", "Facts", "Context", null, false),
    section("asset", "Affected asset", "Context", null, !issue.assetId),
  ];
}

// ------------------------------------------------------------- cloud configuration

/**
 * Rail sections for a configuration finding. "detail" is getConfigFindingDetail's payload
 * — { finding, gap, asset } — with every part tolerated missing.
 *
 * "Affected asset" is empty far more often than the issue sheet's equivalent, and that is
 * the normal case rather than a defect: most AI-security rules are evaluated against a
 * region, an IAM policy or an identity no agent runs as, none of which the AI inventory
 * holds. The section still shows, so the sheet says which it is instead of hiding the
 * question.
 */
export function configFindingSections(detail) {
  var d = detail || {};
  var f = d.finding || {};

  var fix = f.remediation || f.remediationInstructions;
  var ignoreCount = (f.ignoreRuleIds || []).length;
  var iacCount = (f.iacFindingIds || []).length;
  var projectCount = (f.projects || []).length;

  return [
    section("overview", "Overview", null, null, false),
    section("fix", "Remediation", "Remediation", null, !fix),
    section("accepted", "Accepted risk", "Remediation", ignoreCount, ignoreCount === 0),
    section("iac", "Infrastructure as code", "Remediation", iacCount, iacCount === 0),
    section("rule", "The control", "Context", null, !f.ruleDescription),
    section("policy", "Policy", "Context", null, !f.opaPolicy),
    section("resource", "Resource", "Context", null, !f.resourceId),
    section("asset", "Affected asset", "Context", null, !d.asset),
    section("projects", "Projects", "Context", projectCount, projectCount === 0),
    section("facts", "Facts", "Context", null, false),
  ];
}

// -------------------------------------------------------------------------- navigation

/**
 * Prev/next/position for stepping through a record list (an inventory row, an issue table
 * row, ...) one detail sheet at a time. "index" is 0-based; "position" is 1-based and 0
 * when the cursor does not land on a real row at all.
 */
export function recordCursor(ids, index) {
  var list = ids || [];
  var total = list.length;
  var i = Number(index);
  var valid = total > 0 && Number.isFinite(i) && i >= 0 && i < total;
  if (!valid) {
    return { prevId: null, nextId: null, position: 0, total: total };
  }
  return {
    prevId: i > 0 ? list[i - 1] : null,
    nextId: i < total - 1 ? list[i + 1] : null,
    position: i + 1,
    total: total,
  };
}

// ------------------------------------------------------------------------- sheet width

/**
 * The resize floor/ceiling for the detail sheet's draggable width, clamped to an integer
 * pixel count. The floor is applied before the ceiling, so on a viewport too narrow for
 * minPx to fit under maxVwPct — where the ceiling comes out below the floor — that same
 * ordering makes the ceiling win rather than forcing a width the viewport can't hold.
 */
export function clampSheetWidth(px, minPx, maxVwPct, viewportW) {
  var floor = Number(minPx);
  if (!Number.isFinite(floor)) floor = 0;
  var p = Number(px);
  var vw = Number(viewportW);
  var pct = Number(maxVwPct);
  if (!Number.isFinite(p) || !Number.isFinite(vw) || !Number.isFinite(pct)) {
    return Math.round(floor);
  }
  var ceiling = (vw * pct) / 100;
  if (!Number.isFinite(ceiling)) return Math.round(floor);
  return Math.round(Math.min(ceiling, Math.max(floor, p)));
}
