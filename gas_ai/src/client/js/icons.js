// Inline SVG icon sprite for node kinds: path data in a 16x16 viewBox, rendered by
// graphView with class .gnode-icon. Icons accompany the kind LABEL — they are a redundant
// cue, never the only signal.
//
// An entry is a plain `d` string, stroked by CSS, or `{ d, solid: true }` for a filled
// path. Solid paths take `class="gicon-solid"` and paint with `fill: currentColor`, so
// every surface that already strokes the mark in currentColor fills it correctly too.
// Every kind draws a distinct mark: test/icons.test.js fails the build on a duplicate,
// which is what nine alias assignments and one byte-identical pair used to be.

const PATHS = {
  // --- AI assets ---------------------------------------------------------------
  // Supplied artwork, transcribed from a 100x100 source at x0.16. The head outline's
  // bottom-right gap is deliberate — it is where the sparkle sits. Filled circles in the
  // source become `h0.01` dots, the house idiom for a disc under the round linecap.
  AI_AGENT: [
    "M7.68 9.6 L5.12 9.6 C3.84 9.6 2.88 8.64 2.88 7.36 L2.88 6.4 C2.88 5.12 3.84 4.16 5.12 4.16 L9.28 4.16 C10.56 4.16 11.52 5.12 11.52 6.4 L11.52 7.68",
    "M7.2 4.16 L7.2 2.24",
    "M2.88 6.88 L1.6 6.88", "M11.52 6.88 L12.8 6.88",
    "M2.88 14.4 L2.88 13.12 C2.88 11.84 3.84 10.88 5.12 10.88 L6.72 10.88",
    "M5.44 6.88 h0.01", "M8.96 6.88 h0.01",
    { d: "M10.88 8 C10.88 10.24 12.16 11.2 14.4 11.2 C12.16 11.2 10.88 12.16 10.88 14.4 C10.88 12.16 9.6 11.2 7.36 11.2 C9.6 11.2 10.88 10.24 10.88 8 Z", solid: true },
  ],
  // Three linked nodes, per the reference. The nodes are SQUARE on purpose: REPOSITORY,
  // uiIcons' `graph` and the sidebar's Graph mark are all circle-node clusters, and the
  // record-sheet header renders one of them 14px from this glyph.
  AI_MODEL: [
    "M2 2.5 h3.5 v3.5 h-3.5 z",
    "M2 10 h3.5 v3.5 h-3.5 z",
    "M10.5 6.2 h3.5 v3.5 h-3.5 z",
    "M5.5 4.25 L10.5 7.4",
    "M5.5 11.75 L10.5 8.7",
    "M3.75 6 V10",
  ],
  // Barrier gate. Replaces the shield so MISSING_GUARDRAIL can be the same barrier, broken.
  AI_GUARDRAIL: [
    "M2 5.5 h12 v3 h-12 z",
    "M4.5 8.5 V14", "M11.5 8.5 V14",
    "M6 5.5 L4.5 8.5", "M10 5.5 L8.5 8.5",
  ],
  // A pipe with a valve on top: the wide bar is the handwheel, the stem drops into the run,
  // and the two rings are pipe joints. The wide-bar-over-narrow-body shape is what rules out
  // a briefcase, whose handle is always narrower than its case.
  AI_PIPELINE: [
    "M2 8.5 h12 v4.5 h-12 z",
    "M5 8.5 V13", "M11 8.5 V13",
    "M8 8.5 V5",
    "M5.5 5 h5",
  ],
  // Lidded archive box. The cylinder it used to draw now belongs to DATABASE alone.
  AI_DATASET: [
    "M2 3.5 h12 v3 h-12 z",
    "M3 6.5 v7 h10 v-7",
    "M6.5 9.5 h3",
  ],
  // Sitemap: one host, two children. Boxes, not circles — circles here would collide with
  // REPOSITORY and with uiIcons' `graph` mark, which renders 14px away in a sheet header.
  MCP_SERVER: [
    "M6 2 h4 v3 h-4 z",
    "M2 11 h4 v3 h-4 z",
    "M10 11 h4 v3 h-4 z",
    "M8 5 V8", "M4 11 V8 H12 V11",
  ],
  AI_AGENT_REGISTRY: [
    "M2.5 5 h9.5 v8.5 h-9.5 z",
    "M4.5 5 V2.5 h9 v8.5",
    "M4.8 8.2 h5", "M4.8 10.6 h3.2",
  ],
  AI_DEPLOYMENT: [
    { d: "M6 2.5 C6 5.51 7.57 6.8 10.3 6.8 C7.57 6.8 6 8.09 6 11.1 C6 8.09 4.43 6.8 1.7 6.8 C4.43 6.8 6 5.51 6 2.5 Z", solid: true },
    { d: "M11.9 9.1 C11.9 10.85 12.81 11.6 14.4 11.6 C12.81 11.6 11.9 12.35 11.9 14.1 C11.9 12.35 10.99 11.6 9.4 11.6 C10.99 11.6 11.9 10.85 11.9 9.1 Z", solid: true },
  ],
  AI_EXTENSION: [
    "M3 3 h4 a1.4 1.4 0 1 1 2.8 0 h3.2 v3.2 a1.4 1.4 0 1 0 0 2.8 V13 H9.8 a1.4 1.4 0 1 0 -2.8 0 H3 Z",
  ],
  AI_GATEWAY: [
    "M2.5 13.5 V7.5 a5.5 5.5 0 0 1 11 0 V13.5",
    "M5.5 13.5 V8 a2.5 2.5 0 0 1 5 0 V13.5",
    "M1.5 13.5 h13",
  ],
  AI_SERVICE: [
    "M3.5 13 a2.8 2.8 0 0 1 0.3 -5.6 a3.6 3.6 0 0 1 6.7 0.9 a2.4 2.4 0 0 1 -0.2 4.7 z",
    { d: "M12.4 1.9 C12.4 3.65 13.31 4.4 14.9 4.4 C13.31 4.4 12.4 5.15 12.4 6.9 C12.4 5.15 11.49 4.4 9.9 4.4 C11.49 4.4 12.4 3.65 12.4 1.9 Z", solid: true },
  ],
  // Supplied artwork: a dumbbell with the AI sparkle. Reduced, not transcribed — the source
  // draws each plate as a rounded rect and the handle as a pair of rails 10 units apart,
  // which at x0.16 is 1.6, exactly one stroke width, so every pair would weld shut. Each
  // plate becomes the single stroke it would have collapsed into, and the endcaps and the
  // 4-unit gap connectors (0.64 here, narrower than the stroke) are dropped.
  //
  // The source masks the dumbbell out from behind an outlined star. A mask is not
  // expressible in `d` data — but a SOLID sparkle drawn last occludes exactly what the mask
  // hid, and it matches the marker on AI_AGENT, AI_DEPLOYMENT and AI_SERVICE.
  AI_SKILL: [
    "M2.2 7.6 V12",
    "M4.9 6.4 V13.2",
    "M4.9 9.8 H11.1",
    "M11.1 6.4 V13.2",
    "M13.8 7.6 V12",
    { d: "M11.5 1.3 C11.5 3.33 12.56 4.2 14.4 4.2 C12.56 4.2 11.5 5.07 11.5 7.1 C11.5 5.07 10.44 4.2 8.6 4.2 C10.44 4.2 11.5 3.33 11.5 1.3 Z", solid: true },
  ],
  // PROPOSAL, no reference supplied. Sliders no longer mean "skill", so the pair would have
  // stopped reading; this is the dumbbell inside a template frame, minus the sparkle.
  AI_SKILL_TEMPLATE: [
    "M3 2.5 h10 a1.5 1.5 0 0 1 1.5 1.5 v8 a1.5 1.5 0 0 1 -1.5 1.5 h-10 a1.5 1.5 0 0 1 -1.5 -1.5 v-8 a1.5 1.5 0 0 1 1.5 -1.5 z",
    "M4.8 6.4 V9.6",
    "M4.8 8 H11.2",
    "M11.2 6.4 V9.6",
  ],
  AI_TOOL: [
    "M9.8 4.2 a0.67 0.67 0 0 0 0 0.93 l1.07 1.07 a0.67 0.67 0 0 0 0.93 0 l2.51 -2.51 a4 4 0 0 1 -5.29 5.29 l-4.61 4.61 a1.41 1.41 0 0 1 -2 -2 l4.61 -4.61 a4 4 0 0 1 5.29 -5.29 l-2.51 2.51 z",
  ],

  // --- identities --------------------------------------------------------------
  // Supplied artwork: antenna, symmetric ears, rounded head, two eyes, mouth. NOT a literal
  // x0.16 transcription — the source strokes at 4/100 of its grid where the house strokes at
  // 10/16, so at true scale the 5.8-unit head would swallow all three of its own features.
  // Composition and proportions are kept; the head is opened up to 7.4x6.8 and the features
  // spread to clear the stroke. The key this used to draw is now ACCESS_KEY's, where a key
  // actually belongs.
  SERVICE_ACCOUNT: [
    "M6 4.6 h4 a1.7 1.7 0 0 1 1.7 1.7 v3.4 a1.7 1.7 0 0 1 -1.7 1.7 h-4 a1.7 1.7 0 0 1 -1.7 -1.7 v-3.4 a1.7 1.7 0 0 1 1.7 -1.7 z",
    "M8 4.6 V2.3",
    "M2.1 7 V9.4", "M13.9 7 V9.4",
    "M6.3 7.2 h0.01", "M9.7 7.2 h0.01",
    "M6.3 9.4 h3.4",
  ],
  USER_ACCOUNT: ["M8 8 a3 3 0 1 0 0 -6 a3 3 0 0 0 0 6", "M2.5 14 a5.5 4.5 0 0 1 11 0"],
  ACCESS_ROLE: [
    "M3.5 2 h9 v12 h-9 z",
    "M6.5 4.5 h3",
    "M8 9 a1.5 1.5 0 1 0 0 -3 a1.5 1.5 0 0 0 0 3",
    "M5.8 12 a2.4 2 0 0 1 4.4 0",
  ],
  ACCESS_ROLE_BINDING: [
    "M8 2 L14 13.5 H2 Z",
    "M8 7 a1.3 1.3 0 1 0 0 2.6 a1.3 1.3 0 0 0 0 -2.6",
    "M5.8 12.6 a2.4 2 0 0 1 4.4 0",
  ],
  ACCESS_KEY: [
    "M5.5 10.5 m-2.8 0 a2.8 2.8 0 1 0 5.6 0 a2.8 2.8 0 1 0 -5.6 0",
    "M7.5 8.5 L13.5 2.5",
    "M11 5 L12.3 6.3", "M9.4 6.6 L10.7 7.9",
  ],

  // --- data --------------------------------------------------------------------
  BUCKET: ["M3 4 h10 l-1.5 9 a1 1 0 0 1 -1 1 h-5 a1 1 0 0 1 -1 -1 z", "M3 4 a5 1.5 0 0 0 10 0"],
  DATABASE: [
    "M3 4 a5 1.8 0 0 0 10 0 a5 1.8 0 0 0 -10 0",
    "M3 4 v8 a5 1.8 0 0 0 10 0 v-8",
    "M3 8 a5 1.8 0 0 0 10 0",
  ],
  // DATABASE's cylinder, racked: two short drums with a gap, so a server reads as the HOST
  // of databases rather than as one. Narrower than DATABASE on purpose — side by side the
  // pair must not resolve into the same silhouette at 16px.
  DATABASE_SERVER: [
    "M4 3 a4 1.4 0 0 0 8 0 a4 1.4 0 0 0 -8 0",
    "M4 3 v3 a4 1.4 0 0 0 8 0 v-3",
    "M4 9.5 a4 1.4 0 0 0 8 0 a4 1.4 0 0 0 -8 0",
    "M4 9.5 v3 a4 1.4 0 0 0 8 0 v-3",
  ],

  // --- compute / supply chain --------------------------------------------------
  VIRTUAL_MACHINE: ["M1.5 5.5 h9 v8 h-9 z", "M4.5 5.5 V2.5 h9 v8 h-3"],
  SERVERLESS: ["M9 2 L4 9 h3 l-1 5 l6 -7 h-3 z"],
  CONTAINER_IMAGE: [
    "M2 5.5 V3.5 a1.5 1.5 0 0 1 1.5 -1.5 H5.5",
    "M10.5 2 H12.5 a1.5 1.5 0 0 1 1.5 1.5 V5.5",
    "M14 10.5 V12.5 a1.5 1.5 0 0 1 -1.5 1.5 H10.5",
    "M5.5 14 H3.5 a1.5 1.5 0 0 1 -1.5 -1.5 V10.5",
    "M8 5.8 a2.2 2.2 0 1 0 0 4.4 a2.2 2.2 0 0 0 0 -4.4",
  ],
  REPOSITORY: [
    "M5 3 a1.5 1.5 0 1 0 0 3 a1.5 1.5 0 0 0 0 -3",
    "M5 13 a1.5 1.5 0 1 0 0 -3 a1.5 1.5 0 0 0 0 3",
    "M11 5 a1.5 1.5 0 1 0 0 -3 a1.5 1.5 0 0 0 0 3",
    "M5 6 v4", "M11 5 a6 6 0 0 1 -4.5 5",
  ],
  // A listening socket with two arcs radiating off it. Deliberately NOT the globe: the globe
  // is INTERNET_EXPOSURE, a claim that something is reachable, and an endpoint rated Low is
  // an endpoint that is not.
  ENDPOINT: [
    "M2 5.5 h5 v5 h-5 z",
    "M9 4.5 a5 5 0 0 1 0 7",
    "M9 6.8 a2.6 2.6 0 0 1 0 2.4",
  ],

  // --- CIEM findings -----------------------------------------------------------
  // Open padlock: the shackle sits clear of the body. Replaces the warning triangle,
  // which was byte-identical to ISSUE.
  EXCESSIVE_ACCESS_FINDING: [
    "M2 7 h8 v6.5 h-8 z",
    "M8 7 V4.5 a2.6 2.6 0 0 1 5.2 0 V6.2",
    "M6 9.6 v1.6",
  ],
  // Supplied artwork, for a NODE KIND THAT DOES NOT EXIST YET (see the plan). Opened up
  // from the source rather than transcribed: at a literal x0.16 the head is r0.96 against a
  // 1.6 stroke, leaving a 0.32 hole — it renders as a blob. r1.45 restores the source's own
  // radius-to-stroke ratio, and the limbs are lengthened to match.
  IDENTITY_ACCESS_FINDING: [
    "M6.6 2.8 m-1.45 0 a1.45 1.45 0 1 0 2.9 0 a1.45 1.45 0 1 0 -2.9 0",
    "M2.4 8.9 L4.3 6.4 L7 5.9 L5.4 9.2 L8.2 10.6 L6.9 13.4",
    "M6 7.5 H9.7",
    "M4.3 10.4 L2.4 13.2",
    "M11.1 7 V4.4 H14.2 V13.2 H11.1 V10.2",
  ],
  // Host to host. Deliberately not a node-cluster: REPOSITORY, uiIcons' `graph` and the
  // sidebar's Graph mark are all already three-circles-and-lines.
  LATERAL_MOVEMENT_FINDING: [
    "M1.5 5 h4 v6 h-4 z",
    "M10.5 5 h4 v6 h-4 z",
    "M6 8 H9.6",
    "M8.3 6.7 L9.8 8 L8.3 9.3",
  ],

  // --- synthetic ---------------------------------------------------------------
  ISSUE: ["M8 2 L15 14 H1 Z", "M8 6.5 V10", "M8 12 h0.01"],
  SUMMARY: ["M4 8 h0.01", "M8 8 h0.01", "M12 8 h0.01"],
  // The gem, unfinished. SENSITIVE_DATA is now the FALLBACK marker — Wiz says this asset
  // touches classified data, but no path to the store could be walked — so it draws the
  // data-finding gem with its facets and its lower point missing: the same claim, not yet
  // resolved into one. Same idiom as MISSING_GUARDRAIL, which is AI_GUARDRAIL's barrier
  // snapped in two.
  SENSITIVE_DATA: [
    "M4 2.5 h8 l2 3.8",
    "M2 6.3 L4 2.5",
    "M2 6.3 h12",
    "M4.7 8.9 L8 12.7", "M11.3 8.9 L8 12.7",
  ],
  // The gem itself, which is the mark Wiz hangs on a data finding — moved here from
  // SENSITIVE_DATA, where it always described this and stood in for it.
  DATA_FINDING: [
    "M4 2.5 h8 l2 3.8 L8 14 L2 6.3 Z",
    "M2 6.3 h12",
    "M5.9 6.3 L8 14 L10.1 6.3",
    "M4 2.5 L5.9 6.3", "M12 2.5 L10.1 6.3",
  ],
  // The meridians were drawn at rx 9 inside a globe of radius 6, so they ballooned well
  // outside the sphere — the chord is 12, exactly 2*ry, which makes rx the full bulge.
  // rx 3 puts them back on the surface.
  INTERNET_EXPOSURE: [
    "M8 2 a6 6 0 1 0 0 12 a6 6 0 0 0 0 -12",
    "M2 8 h12",
    "M8 2 a3 6 0 0 0 0 12", "M8 2 a3 6 0 0 1 0 12",
  ],
  // ACCESS_KEY's key, struck through: the rights are real and there are too many of them.
  // The strike crosses the shaft at a right angle and stops clear of the bow — run corner
  // to corner it lands on top of the ring and the key stops reading as a key.
  EXCESSIVE_PRIVILEGE: [
    "M5.5 10.5 m-2.8 0 a2.8 2.8 0 1 0 5.6 0 a2.8 2.8 0 1 0 -5.6 0",
    "M7.5 8.5 L13.5 2.5",
    "M11 5 L12.3 6.3",
    "M7.6 2.6 L13.4 8.4",
  ],
  // AI_GUARDRAIL's barrier, snapped in two: both halves keep the rail's depth and meet at
  // a matching jagged break, so absence reads at a glance instead of looking like coverage.
  MISSING_GUARDRAIL: [
    "M2 5.5 h5 l0.8 1.5 l-0.8 1.5 h-5 z",
    "M14 5.5 h-4 l-0.8 1.5 l0.8 1.5 h4 z",
    "M4.5 8.5 V14", "M11.5 8.5 V14",
  ],
};

export const KIND_LABELS = {
  AI_AGENT: "AI Agent",
  AI_MODEL: "AI Model",
  AI_GUARDRAIL: "Guardrail",
  AI_PIPELINE: "AI Pipeline",
  AI_DATASET: "AI Dataset",
  MCP_SERVER: "MCP Server",
  AI_AGENT_REGISTRY: "Agent Registry",
  AI_DEPLOYMENT: "AI Deployment",
  AI_EXTENSION: "AI Extension",
  AI_GATEWAY: "AI Gateway",
  AI_SERVICE: "AI Service",
  AI_SKILL: "AI Skill",
  AI_SKILL_TEMPLATE: "Skill Template",
  AI_TOOL: "AI Tool",
  SERVICE_ACCOUNT: "Service Account",
  USER_ACCOUNT: "User",
  ACCESS_ROLE: "IAM Role",
  ACCESS_ROLE_BINDING: "Role Binding",
  // The one NODE_KINDS entry that had no gloss, so it printed as the raw enum wherever a
  // key turned up as a node's kind.
  ACCESS_KEY: "Access Key",
  BUCKET: "Bucket",
  DATABASE: "Database",
  DATABASE_SERVER: "Database Server",
  VIRTUAL_MACHINE: "VM",
  SERVERLESS: "Serverless",
  ENDPOINT: "Endpoint",
  CONTAINER_IMAGE: "Container Image",
  REPOSITORY: "Repository",
  EXCESSIVE_ACCESS_FINDING: "Excessive Access",
  IDENTITY_ACCESS_FINDING: "Identity Access",
  LATERAL_MOVEMENT_FINDING: "Lateral Movement",
  ISSUE: "Issue",
  SUMMARY: "More",
  SENSITIVE_DATA: "Sensitive Data",
  // Plural: the node is one aggregate per datastore, never one finding.
  DATA_FINDING: "Data Findings",
  INTERNET_EXPOSURE: "Internet Exposure",
  EXCESSIVE_PRIVILEGE: "Excessive Rights",
  MISSING_GUARDRAIL: "No Guardrail",
};

// Built without a literal `//` byte sequence: SSL-inspecting middleboxes have been
// observed truncating served lines at a bare `//` inside strings. The join (which
// esbuild cannot constant-fold) yields the standard SVG namespace URL at runtime;
// the build guard in esbuild.config.mjs enforces the invariant.
export const SVG_NS = ["http:", "", "www.w3.org", "2000", "svg"].join("/");

/**
 * Namespaced SVG element with attributes. graphView.js had its own copy of this and its
 * own copy of SVG_NS, directly against the note below that the namespace must never be
 * spelled out at a call site.
 */
export function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

/**
 * A kind's raw path data, for tests and tooling. Returns null for an unknown kind rather
 * than kindIcon's SUMMARY fallback, so a coverage check can tell "this kind has no glyph"
 * apart from "this kind draws the collapse stub". Hands back a copy: PATHS is module-private
 * precisely so nobody can reach in and mutate it the way the alias block did.
 */
export function glyphPaths(kind) {
  const paths = PATHS[kind];
  return paths ? paths.slice() : null;
}

/** A 16x16 stroke icon <g> for a node kind (falls back to the summary dots). */
export function kindIcon(kind, size = 16) {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "gnode-icon");
  g.setAttribute("aria-hidden", "true");
  const paths = PATHS[kind] || PATHS.SUMMARY;
  for (const entry of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", typeof entry === "string" ? entry : entry.d);
    // A solid path is filled, not stroked. The class stands on its own rather than being
    // scoped under .gnode-icon: pages/help.js relabels this group as help-node-icon, which
    // would silently stop a `.gnode-icon .solid` rule matching there.
    if (typeof entry !== "string" && entry.solid) p.setAttribute("class", "gicon-solid");
    g.append(p);
  }
  if (size !== 16) g.setAttribute("transform", `scale(${size / 16})`);
  return g;
}

/**
 * The same icon as a standalone <svg>, for use outside the graph canvas (cards, chips,
 * lists). kindIcon() alone returns a bare <g>, which renders nothing without this wrapper.
 *
 * Callers get this rather than building an <svg> themselves: SVG_NS above is assembled at
 * runtime to dodge a middlebox that truncates a bare `//` inside a string literal, and the
 * build guard fails on one — so the namespace must never be spelled out at a call site.
 *
 * It carries no class of its own; the caller names it (`asset-card-icon`, `kind-icon`) and
 * styles the stroke through that name. Note the stroke lives on the inner <g>, which
 * .gnode-icon paints a fixed grey — a rule on this <svg> is inherited and loses to it, so
 * a caller that wants its own colour must target `<name> .gnode-icon`.
 */
export function kindIconSvg(kind, size = 16) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  // Keeps legacy Edge/IE from putting a tab stop on an SVG that is already aria-hidden.
  svg.setAttribute("focusable", "false");
  // The <g> is drawn at its native 16x16 and scaled by the viewBox, so no transform.
  svg.append(kindIcon(kind, 16));
  return svg;
}

export function kindLabel(kind) {
  return KIND_LABELS[kind] || kind;
}

/**
 * Several kinds, in prose — "AI Agent, Bucket or Service Account".
 *
 * A query node can name more than one kind, and its IDENTITY is the list joined by `-`
 * ("AI_AGENT-BUCKET"), which is what the wire and the column groups carry. Passing that key
 * straight to `kindLabel` finds no entry and echoes the raw token back, so anywhere a node's
 * kinds are shown to a reader comes through here instead — the table's group heading and the
 * builder's row labels both do.
 *
 * "or" rather than "and": the node matches any ONE of them, and a reader who sees "AI Agent and
 * Bucket" would reasonably expect the impossible thing. ANY is spelled out because it is not a
 * kind and `KIND_LABELS` has no entry for it.
 */
export function kindsLabel(kinds) {
  const list = Array.isArray(kinds) ? kinds : String(kinds || "").split("-");
  const names = list.filter(Boolean).map((k) => (k === "ANY" ? "Any node" : kindLabel(k)));
  if (names.length < 2) return names[0] || "";
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}

// Wiz's edge-type enum is precise and stays one hover away via the edge's title
// tooltip / domain-chip text; it is not what a reader can scan off a curve between two
// node cards in a ~500px diagram. EDGE_LABELS is that prose gloss — lowercase,
// subject-first ("agent runs as account"), short enough to sit on the line unclipped.
export const EDGE_LABELS = {
  HAS_ISSUE: "has issue",
  PROTECTED_BY: "protected by",
  RUNS_AS: "runs as",
  ALLOWS_ACCESS_TO: "allows access to",
  HAS_FINDING: "has finding",
  USES: "uses",
  USES_TOOL: "uses tool",
  INVOKES_TOOL: "invokes tool",
  USES_MODEL: "uses model",
  USES_DATASET: "uses dataset",
  STORED_IN: "stored in",
  HOSTED_ON: "hosted on",
  SERVES: "serves",
  BUILT_FROM: "built from",
  CAN_INVOKE: "can invoke",
  ENFORCES: "enforces",
  BOUND_TO: "bound to",
  PERMITS_ACCESS_ROLE: "permits access role",
  HAS_SENSITIVE_DATA: "has sensitive data",
  HAS_ACCESS_TO_SENSITIVE_DATA: "has access to sensitive data",
  EXPOSED_TO_INTERNET: "exposed to internet",
  HAS_EXCESSIVE_PRIVILEGE: "has excessive privilege",
  HAS_DATA_FINDING: "has data findings",
};

/** Human-readable label for an edge type; unknown types fall back to the raw enum. */
export function edgeLabel(type) {
  return EDGE_LABELS[type] || type;
}

// Semantic category of a node kind — drives the graph's color coding (a redundant cue
// beside the kind icon + label, never the only signal). Five categories plus a neutral
// fallback for collapse stubs. Categories deliberately sit OFF the severity color channel
// so the per-node severity dot keeps reading true.
export const KIND_CATEGORY = {
  // assets (blue): AI-SPM assets + the compute/supply-chain they run on
  AI_AGENT: "asset", AI_MODEL: "asset", AI_GUARDRAIL: "asset", AI_PIPELINE: "asset",
  MCP_SERVER: "asset", AI_AGENT_REGISTRY: "asset", AI_DEPLOYMENT: "asset",
  AI_EXTENSION: "asset", AI_GATEWAY: "asset", AI_SERVICE: "asset", AI_SKILL: "asset",
  AI_SKILL_TEMPLATE: "asset", AI_TOOL: "asset",
  VIRTUAL_MACHINE: "asset", SERVERLESS: "asset", CONTAINER_IMAGE: "asset", REPOSITORY: "asset",
  // Inventory, not evidence — so it takes the asset tint rather than the exposure one, for
  // the reason AI_DATASET and BUCKET take theirs. An endpoint rated Low is a real endpoint
  // and not an exposure; painting every endpoint yellow would say otherwise. Whether one
  // IS an exposure is carried by the INTERNET_EXPOSURE node its asset gains.
  ENDPOINT: "asset",
  // data (green): datastores, datasets, and the two data markers. DATA_FINDING is filed
  // here rather than with the red findings deliberately — it is the last hop of the data
  // chain and Wiz draws it in the data tint. Its badness reaches the eye through the card's
  // own severity dot and word, so nothing is carried by colour alone either way.
  AI_DATASET: "data", BUCKET: "data", DATABASE: "data", DATABASE_SERVER: "data",
  SENSITIVE_DATA: "data", DATA_FINDING: "data",
  // IAM / access (purple). ACCESS_KEY was missing here for as long as it has existed, so a
  // credential rendered in the asset tint while its own label said "Access Key".
  SERVICE_ACCOUNT: "iam", USER_ACCOUNT: "iam", ACCESS_ROLE: "iam", ACCESS_ROLE_BINDING: "iam",
  ACCESS_KEY: "iam",
  // vulnerabilities & misconfigurations (red)
  ISSUE: "vuln", EXCESSIVE_ACCESS_FINDING: "vuln", IDENTITY_ACCESS_FINDING: "vuln",
  LATERAL_MOVEMENT_FINDING: "vuln",
  EXCESSIVE_PRIVILEGE: "vuln", MISSING_GUARDRAIL: "vuln",
  // internet exposure (yellow)
  INTERNET_EXPOSURE: "exposure",
  // neutral
  SUMMARY: "neutral",
};

/** Semantic category for a node kind; unknown kinds fall back to "asset". */
export function categoryOf(kind) {
  return KIND_CATEGORY[kind] || "asset";
}

// Legend order + labels for the category color key.
export const CATEGORY_ORDER = ["asset", "data", "iam", "vuln", "exposure"];
export const CATEGORY_LABELS = {
  asset: "AI assets & compute",
  data: "Data",
  iam: "IAM & access",
  vuln: "Vulnerabilities",
  exposure: "Internet exposure",
};
