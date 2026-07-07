// "What we scan with Wiz" — the static coverage content, editable in one place.
// Sourced from ai/ai_agents_discovery_queries.md, ai/ai_framework.md and
// ai/ai_issues_and_complience_overview.md. Stats reflect the documented tenant
// posture; update them alongside the source docs.

export const SCAN_AREAS = [
  {
    id: "aispm",
    title: "AI-SPM Inventory",
    what: "Discovers every AI asset across clouds — agents (managed and hosted), " +
      "models, guardrails, pipelines, datasets and MCP servers — with ownership, " +
      "region and project context.",
    stat: "71 agents · 3 guardrails · 7 projects",
    link: "inventory",
  },
  {
    id: "toxic",
    title: "Toxic Combination Engine",
    what: "Multi-condition rules that only fire when risks combine: privileged agents " +
      "with sensitive data access, model invocation without guardrails, permissive " +
      "execution identities.",
    stat: "29 open issues · 4 patterns",
    link: "combos",
  },
  {
    id: "ciem",
    title: "CIEM / IAM Analysis",
    what: "Effective-permission analysis on every identity an AI asset runs as or is " +
      "reachable from — excessive access and lateral-movement findings on execution " +
      "service accounts.",
    link: "graph",
  },
  {
    id: "dspm",
    title: "Sensitive Data (DSPM)",
    what: "Classifies PII/PHI/PCI in buckets and databases, then flags which AI assets " +
      "can reach it (hasSensitiveData / hasAccessToSensitiveData on the graph).",
    link: "graph",
  },
  {
    id: "guardrails",
    title: "Guardrail Coverage",
    what: "Checks the PROTECTED_BY relationship between agents/models and guardrails; " +
      "an absent edge marks the asset “no guardrail” — the strongest single amplifier " +
      "in the toxic combinations.",
    stat: "3 of 71 agents protected (≈4%)",
    link: "graph",
  },
  {
    id: "exposure",
    title: "Network Exposure",
    what: "Internet reachability on AI assets and their hosts. Managed agents report it " +
      "directly; hosted agents inherit it from the VM or Cloud Run service — shown as " +
      "“unknown” until the host is checked.",
  },
  {
    id: "identity",
    title: "Human Identity & MFA",
    what: "Which people (and external identities) can reach AI assets, with MFA status " +
      "and inactivity signals on those accounts.",
  },
  {
    id: "supply",
    title: "Code-to-Cloud Supply Chain",
    what: "Traces hosted agents back through container images to source repositories " +
      "(BUILT_FROM), surfacing malicious-package and pipeline findings on the path.",
  },
  {
    id: "compliance",
    title: "Compliance Frameworks",
    what: "Continuous scoring against the AI security frameworks enabled in the tenant.",
    stat: "OWASP LLM 97% · ML 99% · Agentic 98% · 5Rs 53%",
    callout: "5Rs (data security) at 53% is the critical gap — it amplifies every " +
      "sensitive-data issue. ISO 42001:2023 is available but currently disabled.",
  },
];
