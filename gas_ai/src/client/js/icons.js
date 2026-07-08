// Inline SVG icon sprite for node kinds: stroke path data in a 16x16 viewBox,
// rendered by graphView with class .gnode-icon. Icons accompany the kind LABEL —
// they are a redundant cue, never the only signal.

const PATHS = {
  AI_AGENT: [
    "M4 6 h8 v6 a2 2 0 0 1 -2 2 h-4 a2 2 0 0 1 -2 -2 z",
    "M8 6 V3", "M8 3 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0",
    "M6 9.5 h0.01", "M10 9.5 h0.01",
  ],
  AI_MODEL: ["M8 2 L14 5 L8 8 L2 5 Z", "M2 8 L8 11 L14 8", "M2 11 L8 14 L14 11"],
  AI_GUARDRAIL: ["M8 2 L13 4 V8 C13 11 11 13 8 14 C5 13 3 11 3 8 V4 Z", "M6 8 L7.5 9.5 L10.5 6.5"],
  AI_PIPELINE: ["M2 4 h4 v4 h-4 z", "M10 8 h4 v4 h-4 z", "M6 6 h2 a2 2 0 0 1 2 2 v2"],
  AI_DATASET: ["M3 4 a5 1.8 0 0 0 10 0 a5 1.8 0 0 0 -10 0", "M3 4 v8 a5 1.8 0 0 0 10 0 v-8", "M3 8 a5 1.8 0 0 0 10 0"],
  MCP_SERVER: ["M5 2 v4", "M11 2 v4", "M3 6 h10 v3 a5 5 0 0 1 -10 0 z", "M8 14 v-2"],
  SERVICE_ACCOUNT: ["M9 7 a3 3 0 1 0 -3 -3", "M9 7 L3 13", "M5 11 l1.5 1.5", "M7 9 l1.5 1.5"],
  USER_ACCOUNT: ["M8 8 a3 3 0 1 0 0 -6 a3 3 0 0 0 0 6", "M2.5 14 a5.5 4.5 0 0 1 11 0"],
  ACCESS_ROLE: ["M4 2 h8 v12 h-8 z", "M6 5 h4", "M8 9 a1.5 1.5 0 1 0 0 -3 a1.5 1.5 0 0 0 0 3", "M6 12 a2 2 0 0 1 4 0"],
  ACCESS_ROLE_BINDING: ["M6 10 L10 6", "M4 8 a3 3 0 0 1 0 -4 l1 -1 a3 3 0 0 1 4 0", "M12 8 a3 3 0 0 1 0 4 l-1 1 a3 3 0 0 1 -4 0"],
  BUCKET: ["M3 4 h10 l-1.5 9 a1 1 0 0 1 -1 1 h-5 a1 1 0 0 1 -1 -1 z", "M3 4 a5 1.5 0 0 0 10 0"],
  DATABASE: ["M3 4 a5 1.8 0 0 0 10 0 a5 1.8 0 0 0 -10 0", "M3 4 v8 a5 1.8 0 0 0 10 0 v-8"],
  VIRTUAL_MACHINE: ["M2 3 h12 v8 h-12 z", "M6 14 h4", "M8 11 v3"],
  SERVERLESS: ["M9 2 L4 9 h3 l-1 5 l6 -7 h-3 z"],
  CONTAINER_IMAGE: ["M2 5 L8 2 L14 5 V11 L8 14 L2 11 Z", "M2 5 L8 8 L14 5", "M8 8 V14"],
  REPOSITORY: ["M5 3 a1.5 1.5 0 1 0 0 3 a1.5 1.5 0 0 0 0 -3", "M5 13 a1.5 1.5 0 1 0 0 -3 a1.5 1.5 0 0 0 0 3", "M11 5 a1.5 1.5 0 1 0 0 -3 a1.5 1.5 0 0 0 0 3", "M5 6 v4", "M11 5 a6 6 0 0 1 -4.5 5"],
  EXCESSIVE_ACCESS_FINDING: ["M8 2 L15 14 H1 Z", "M8 6.5 V10", "M8 12 h0.01"],
  LATERAL_MOVEMENT_FINDING: ["M2 5 h9", "M9 2.5 L11.5 5 L9 7.5", "M14 11 h-9", "M7 8.5 L4.5 11 L7 13.5"],
  ISSUE: ["M8 2 L15 14 H1 Z", "M8 6.5 V10", "M8 12 h0.01"],
  SUMMARY: ["M4 8 h0.01", "M8 8 h0.01", "M12 8 h0.01"],
  // Padlock — reads as "sensitive", distinct from the shield (guardrail) and cylinder (dataset).
  SENSITIVE_DATA: ["M4 7 h8 v6 h-8 z", "M6 7 V5 a2 2 0 0 1 4 0 V7", "M8 9.5 v2"],
};

// Tenant-vocabulary AI kinds reuse the closest existing glyph (icons are a
// redundant cue beside the text label, never the only signal).
PATHS.AI_AGENT_REGISTRY = PATHS.REPOSITORY;
PATHS.AI_DEPLOYMENT = PATHS.VIRTUAL_MACHINE;
PATHS.AI_EXTENSION = PATHS.AI_PIPELINE;
PATHS.AI_GATEWAY = PATHS.MCP_SERVER;
PATHS.AI_SERVICE = PATHS.AI_MODEL;
PATHS.AI_SKILL = PATHS.SERVERLESS;
PATHS.AI_SKILL_TEMPLATE = PATHS.CONTAINER_IMAGE;
PATHS.AI_TOOL = PATHS.SERVERLESS;

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
  BUCKET: "Bucket",
  DATABASE: "Database",
  VIRTUAL_MACHINE: "VM",
  SERVERLESS: "Serverless",
  CONTAINER_IMAGE: "Container Image",
  REPOSITORY: "Repository",
  EXCESSIVE_ACCESS_FINDING: "Excessive Access",
  LATERAL_MOVEMENT_FINDING: "Lateral Movement",
  ISSUE: "Issue",
  SUMMARY: "More",
  SENSITIVE_DATA: "Sensitive Data",
};

// Built without a literal `//` byte sequence: SSL-inspecting middleboxes have been
// observed truncating served lines at a bare `//` inside strings. The join (which
// esbuild cannot constant-fold) yields the standard SVG namespace URL at runtime;
// the build guard in esbuild.config.mjs enforces the invariant.
const SVG_NS = ["http:", "", "www.w3.org", "2000", "svg"].join("/");

/** A 16x16 stroke icon <g> for a node kind (falls back to the summary dots). */
export function kindIcon(kind, size = 16) {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "gnode-icon");
  g.setAttribute("aria-hidden", "true");
  const paths = PATHS[kind] || PATHS.SUMMARY;
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    g.append(p);
  }
  if (size !== 16) g.setAttribute("transform", `scale(${size / 16})`);
  return g;
}

export function kindLabel(kind) {
  return KIND_LABELS[kind] || kind;
}
