// The compliance-gap codebook: what a gap code MEANS, so the pillar-B cascade can be read
// and built by someone who has never seen LLM06.
//
// Three rules govern this file.
//
// 1. Titles are ANNOTATION, never input. The score matches on the opaque code exactly as it
//    always has (gapPointsFor in src/domain/aars.ts); nothing here reaches the scoring model.
//    That is what lets the codebook be wrong, or incomplete, without producing a wrong score.
//
// 2. Every family carries its VINTAGE and its STANDING, because they are not equally
//    authoritative. OWASP shipped an LLM Top 10 2026 that renumbers eight of ten entries —
//    this repo encodes 2025 (ai/custom_score.md spells the titles out) — the Agentic list is
//    a 2026 release that supersedes a differently-numbered T1–T15 list still in circulation,
//    the ML list is a perpetual draft, and the 5Rs are a vendor taxonomy of response actions
//    rather than risks. Flattening those into one list would claim a confidence none of them
//    supports.
//
// 3. A code the book does not carry is a normal input, not an error. Wiz config findings
//    contribute tenant-specific rule shortIds (SUB-082), which is exactly what the cascade's
//    fallback price exists to govern.

/** A family prefix is a match-on-prefix rule, not a code an asset can carry. */
export const FAMILY_GROUP = "Family prefixes";

export const CODEBOOK = [
  {
    group: "OWASP LLM Top 10",
    vintage: "2025 edition",
    standing:
      "Published. The 2026 edition (released 3 August 2026) renumbers eight of the ten " +
      "entries — this model is written against 2025, so a code here means what 2025 says it " +
      "means. Five codes MEAN DIFFERENT THINGS across the two vintages, and two pairs " +
      "effectively swap: 2025 LLM03 Supply Chain → 2026 LLM04, while 2026 LLM03 is Excessive " +
      "Agency (2025 LLM06); 2025 LLM05 Improper Output Handling → 2026 LLM10, while 2026 LLM05 " +
      "is Data and Model Poisoning (2025 LLM04); 2025 LLM07 System Prompt Leakage → 2026 LLM08, " +
      "renamed Hidden Context Exposure; 2025 LLM10 Unbounded Consumption → 2026 LLM06. Only " +
      "LLM01 and LLM02 keep their number. A connector emitting 2026 codes into this cascade " +
      "would be priced against the wrong risk — check the vintage before trusting a code.",
    entries: [
      ["LLM01", "Prompt Injection", "Crafted input alters the model's behaviour, bypassing its instructions or safety rules."],
      ["LLM02", "Sensitive Information Disclosure", "The model reveals PII, secrets or proprietary data in its output."],
      ["LLM03", "Supply Chain", "Compromised third-party models, datasets, adapters or plugins enter the stack."],
      ["LLM04", "Data and Model Poisoning", "Tampered training or fine-tuning data corrupts behaviour or plants a backdoor."],
      ["LLM05", "Improper Output Handling", "Model output passes downstream unvalidated, enabling XSS, SSRF or code execution."],
      ["LLM06", "Excessive Agency", "The model holds more permission, tooling or autonomy than its task needs."],
      ["LLM07", "System Prompt Leakage", "The system prompt leaks, exposing secrets or the logic needed to bypass controls."],
      ["LLM08", "Vector and Embedding Weaknesses", "Flaws in RAG vectors and embeddings leak data or inject content via retrieval."],
      ["LLM09", "Misinformation", "The model emits confident, fabricated or wrong output that users act on."],
      ["LLM10", "Unbounded Consumption", "Unmetered inference lets attackers drain cost and capacity, or extract the model."],
    ],
  },
  {
    group: "OWASP Agentic (ASI)",
    vintage: "2026 edition",
    standing:
      "Published 1.0 (announced December 2025). It does NOT supersede the T-numbered list: " +
      "“Agentic AI — Threats and Mitigations” is a parallel companion, updated to v1.1 in the " +
      "same release and now running T1–T17, not T1–T15. The two are different layers — ASI is " +
      "the ranked risk list, T is the granular attack pathway — and OWASP ships the official " +
      "cross-map in ASI 2026 Appendix A. A scanner emitting T13 spans ASI10 and ASI04.",
    entries: [
      ["ASI01", "Agent Goal Hijack", "Untrusted content redirects the agent's objective while it believes it serves the user."],
      ["ASI02", "Tool Misuse & Exploitation", "Legitimate tools weaponised via deceptive input, poisoned metadata or unsafe chaining."],
      ["ASI03", "Identity & Privilege Abuse", "Over-broad delegated credentials turn any hijack into unauthorised action."],
      ["ASI04", "Agentic Supply Chain Vulnerabilities", "Compromised frameworks, MCP servers or tool schemas the agent dynamically trusts."],
      ["ASI05", "Unexpected Code Execution (RCE)", "Agent-generated or agent-triggered code runs outside its sandbox or validation boundary."],
      ["ASI06", "Memory & Context Poisoning", "Data planted in persistent memory or retrieval steers behaviour in later sessions."],
      ["ASI07", "Insecure Inter-Agent Communication", "Agent-to-agent messages spoofed, replayed or tampered with for lack of auth."],
      ["ASI08", "Cascading Failures", "One agent's error or compromise fans out through connected workflows at scale."],
      ["ASI09", "Human-Agent Trust Exploitation", "Agents manipulate the human approval step by controlling what the reviewer is shown."],
      ["ASI10", "Rogue Agents", "Agents operating outside policy while appearing legitimate, via drift or compromise."],
    ],
  },
  {
    group: "OWASP ML",
    vintage: "draft v0.3",
    standing:
      "Still officially a draft and modified frequently. These codes are DERIVED — the sync " +
      "builds ML_ plus the finding's title, so they carry no ordinal and the ML0n below is a " +
      "mapping this page states, not one the data contains.",
    entries: [
      ["ML_INPUT_MANIPULATION", "Input Manipulation Attack (ML01)", "Adversarial inputs perturbed just enough to force a wrong prediction."],
      ["ML_DATA_POISONING", "Data Poisoning Attack (ML02)", "Training data tampered with so the model learns attacker-chosen behaviour."],
      ["ML_MODEL_INVERSION", "Model Inversion Attack (ML03)", "Querying the model to reconstruct sensitive training records."],
      ["ML_MEMBERSHIP_INFERENCE", "Membership Inference Attack (ML04)", "Determining whether a specific record was in the training set."],
      ["ML_MODEL_THEFT", "Model Theft (ML05)", "Extracting or exfiltrating model weights or behaviour via queries or access."],
      ["ML_SUPPLY_CHAIN", "AI Supply Chain Attacks (ML06)", "Compromised packages, datasets or pre-trained models enter the pipeline."],
      ["ML_TRANSFER_LEARNING", "Transfer Learning Attack (ML07)", "A backdoored base model carries its malicious behaviour into the fine-tune."],
      ["ML_MODEL_SKEWING", "Model Skewing (ML08)", "Manipulating the feedback or retraining loop to shift outputs over time."],
      ["ML_OUTPUT_INTEGRITY", "Output Integrity Attack (ML09)", "Tampering with model output in transit or at the interface, not the model itself."],
      ["ML_MODEL_POISONING", "Model Poisoning (ML10)", "Directly altering model parameters or weights to make it misbehave."],
    ],
  },
  {
    group: "Wiz 5Rs",
    vintage: "vendor taxonomy",
    standing:
      "Wiz's own data-security response taxonomy — no public canonical spec, and these are " +
      "RESPONSE ACTIONS rather than risks, so they are a different kind of thing from the " +
      "OWASP entries above. The sync's issue enrichment does not read 5Rs mappings at all: " +
      "these codes reach the cascade only through failing config findings.",
    entries: [
      ["FIVE_RS", "A failing 5Rs control", "Any 5Rs control the asset fails, without naming which of the five."],
      ["5R_REDUCE", "Reduce", "Stop data sprawl by finding and deleting shadow data."],
      ["5R_RESTRICT", "Restrict", "Map and remove any over-privileged access."],
      ["5R_RELABEL", "Relabel", "Label cloud assets with their data sensitivity."],
      ["5R_RELOCATE", "Relocate", "Ensure data jurisdiction complies with your needs."],
      ["5R_RECONFIGURE", "Reconfigure", "Ensure configurations such as encryption and retention are set."],
    ],
  },
  {
    group: "Local to this model",
    vintage: "synthesised on sync",
    standing:
      "Not a framework code. The enrichment pass raises these itself, so they are stable by " +
      "definition and change only when this app changes. NO_GUARDRAIL is always raised; " +
      "DEPRECATED_MODEL and INACTIVE_AGENT are read off the asset's own status and only " +
      "reach the cascade when their gap source is switched on in the rule — until then a " +
      "row pricing them can never fire.",
    entries: [
      ["NO_GUARDRAIL", "No guardrail attached", "Guardrail coverage flagged the asset — the LLM01 / ASI01 gap."],
      ["DEPRECATED_MODEL", "Deprecated model", "The asset runs a model the provider has retired, e.g. text-embedding-005."],
      ["INACTIVE_AGENT", "Dormant agent", "Inactive, but still holding its privileges and data reach — the ASI10 Rogue Agents shape."],
    ],
  },
  {
    group: FAMILY_GROUP,
    vintage: "match a whole vocabulary",
    standing:
      "Not codes an asset carries — these are what a “starts with” rule matches on. Price " +
      "the family once here, then put any exact carve-out ABOVE it.",
    entries: [
      ["LLM", "The OWASP LLM family", "Matches every LLM code. Exact rows for single entries must sit above this one."],
      ["ASI", "The OWASP Agentic family", "Matches every ASI code."],
      ["ML", "The OWASP ML family", "Matches every derived ML_ code."],
      ["5R", "The Wiz 5Rs family", "Matches every 5R_ code. Note FIVE_RS does not start with 5R."],
    ],
  },
];

/** code → {code, title, blurb, group, vintage, standing, isFamily}. Built once. */
const BY_CODE = Object.create(null);
/** Every non-family entry, in codebook order — the census and family counts walk this. */
const REAL_ENTRIES = [];

for (const family of CODEBOOK) {
  const isFamily = family.group === FAMILY_GROUP;
  for (const [code, title, blurb] of family.entries) {
    const entry = {
      code,
      title,
      blurb,
      group: family.group,
      vintage: family.vintage,
      standing: family.standing,
      isFamily,
    };
    BY_CODE[code] = entry;
    if (!isFamily) REAL_ENTRIES.push(entry);
  }
}

/** Normalise the way the scoring model does, so a lookup can never disagree with a match. */
export function normalizeCode(code) {
  return String(code == null ? "" : code).trim().toUpperCase();
}

/** The codebook entry for a code, or null. Family prefixes resolve too. */
export function lookupGap(code) {
  return BY_CODE[normalizeCode(code)] || null;
}

/** The real codes a `starts with` rule would match. Family prefixes never match each other. */
export function familyMembers(prefix) {
  const p = normalizeCode(prefix);
  if (!p) return [];
  return REAL_ENTRIES.filter((e) => e.code.indexOf(p) === 0);
}

/**
 * How many rows ABOVE `index` name a code inside this row's family — the carve-outs an
 * operator has to see when they read a prefix row, because they are the reason the family
 * price is not the whole story.
 */
export function pricedAboveCount(gapPoints, index) {
  const rows = gapPoints || [];
  const row = rows[index];
  if (!row || row.match !== "prefix") return 0;
  const p = normalizeCode(row.code);
  if (!p) return 0;
  let n = 0;
  for (let i = 0; i < index; i++) {
    const earlier = rows[i];
    if (!earlier) continue;
    if (normalizeCode(earlier.code).indexOf(p) === 0) n++;
  }
  return n;
}

/**
 * The gloss under a cascade row's code field: what this rule actually says, in words.
 *
 * `shape` is a mark carried ALONGSIDE the words, never instead of them — the page has no
 * colour to spend here, and a reader who cannot see the mark still gets the sentence.
 *
 *   ● exact    a single named entry
 *   ◧ family   a prefix covering a whole vocabulary
 *   ◇ unknown  a code the book does not carry — a tenant finding ID, priced by the fallback
 */
export function resolveGap(code, match, opts) {
  const o = opts || {};
  const c = normalizeCode(code);
  if (!c) return { shape: "◇", known: false, text: "no code yet" };

  if (match === "prefix") {
    const members = familyMembers(c);
    // Provenance comes from what the prefix MATCHES, never from the family-prefix pseudo
    // entry — that one's own group is "Family prefixes", which says nothing about the
    // vocabulary being priced. A prefix that straddles two vocabularies names neither.
    const groups = {};
    for (const m of members) groups[m.group + " " + m.vintage] = true;
    const names = Object.keys(groups);
    const provenance = names.length === 1 ? names[0] : "";
    if (!members.length) {
      return {
        shape: "◇",
        known: false,
        text: "not in the codebook · matches any code starting " + c,
      };
    }
    const parts = ["family · " + members.length + (members.length === 1 ? " code" : " codes")];
    const above = Number(o.pricedAbove) || 0;
    if (above) parts.push(above + " priced above");
    if (provenance) parts.push(provenance);
    return { shape: "◧", known: true, text: parts.join(" · ") };
  }

  const entry = BY_CODE[c];
  if (!entry || entry.isFamily) {
    // A family prefix used as an EXACT match is almost always a mistake — "is exactly LLM"
    // matches nothing, because no asset carries the bare family code.
    const hint = entry && entry.isFamily
      ? "a family prefix — matches nothing as an exact rule"
      : "tenant code";
    const fb = o.fallbackPoints;
    const tail = typeof fb === "number" ? " · prices at the fallback, " + fb : "";
    return { shape: "◇", known: false, text: "not in the codebook · " + hint + tail };
  }
  return {
    shape: "●",
    known: true,
    text: "exact · " + entry.title + " · " + entry.group + " " + entry.vintage,
  };
}

/**
 * Options for `filterCombobox`, which already searches `label` AND `hint` — so the blurb
 * riding along as the hint is what lets "agency", "poison" or "over-privileged" find the
 * right code without knowing its number.
 *
 * `census` is `{CODE: assetCount}` from the preview; when present each option says how many
 * live assets actually carry the code, which turns the picker from a dictionary into a
 * prioritisation surface. Absent (before the first preview lands) the options are the same
 * minus that clause.
 */
export function gapCodeOptions(census) {
  const counts = census || {};
  const options = [];
  for (const family of CODEBOOK) {
    const group = family.group + " · " + family.vintage;
    for (const [code, title, blurb] of family.entries) {
      const n = counts[code];
      const seen = typeof n === "number" && n > 0
        ? " — " + n + (n === 1 ? " asset" : " assets")
        : "";
      options.push({ value: code, label: code + " · " + title, hint: blurb + seen, group });
    }
  }
  return options;
}

/**
 * Codes the inventory carries that the codebook does not name — tenant finding shortIds.
 * They belong in the picker too: they are the codes most likely to need a rule, and the
 * operator has no other way to learn they exist.
 */
export function tenantCodeOptions(census) {
  const counts = census || {};
  const out = [];
  for (const code of Object.keys(counts)) {
    if (BY_CODE[code]) continue;
    const n = counts[code];
    out.push({
      value: code,
      label: code,
      hint: "seen on " + n + (n === 1 ? " asset" : " assets") + " — not in the codebook",
      group: "Seen in this tenant · not in the codebook",
    });
  }
  return out.sort((a, b) => (counts[b.value] - counts[a.value]) || a.value.localeCompare(b.value));
}

/** Every code the book names, for the reference sheet's coverage audit. */
export function allCodes() {
  return REAL_ENTRIES.map((e) => e.code);
}
