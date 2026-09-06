// The one piece of register vocabulary a launcher still needs: the severity fills.
//
// THIS FILE EXISTS FOR A TEST, AND THAT IS THE HONEST REASON. The hub measures no
// population — it has no findings, no severities and no SLA windows — so nothing in
// src/client draws with these. `gas_shared/test/contracts/tokens.js` reads
// `severity.SEVERITY_COLORS` off `ctx` with NO FALLBACK (:140, :152, :162) and would throw
// rather than skip, so registering the token contract at all requires a copy here. The other
// two halves of a register's config are handled differently, and deliberately:
//
//   - SEVERITY_TEXT is not here: the contract falls back to the `--sev-*-text` custom
//     properties in gas_shared/styles/tokens.base.css, which this app ships like every
//     other, so the darkened-label rule is still checked against the real tokens.
//   - SLA_TARGETS is not here: the contract's SLA block becomes a NAMED SKIP saying this
//     app has no remediation windows, rather than a copy of three numbers nothing reads.
//
// BYTE-IDENTICAL TO THE THREE REGISTERS, which is the point of copying rather than inventing:
// gas/src/domain/config.ts, gas_ai/src/domain/config.ts and gas_devsecops/src/domain/config.ts
// carry exactly these six fills, and a severity has to mean the same thing in every sidekick.
// The brand accent deliberately does not — see src/client/styles/tokens.css, where the hub's
// graphite lives and where the four tile colours are defined.

/** Graphical marks — dots, bars, chart series. Tuned to >= 3:1 on white. */
export const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ea580c",
  MEDIUM: "#d97706",
  LOW: "#2563eb",
  INFO: "#64748b",
  UNKNOWN: "#475569",
};
