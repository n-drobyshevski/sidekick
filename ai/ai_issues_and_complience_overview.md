



[Risk Issues](https://app.wiz.io/issues#%7E%28filters%7E%28status%7E%28equals%7E%28%7E%27OPEN%7E%27IN_PROGRESS%29%29%7Erisk%7E%28includesAny%7E%28%7E%27wct-id-1998%29%29%7Esearch%7E%28contains%7E%27AI%29%29%29)

[Risk Issues](https://app.wiz.io/issues#%7E%28filters%7E%28status%7E%28equals%7E%28%7E%27OPEN%7E%27IN_PROGRESS%29%29%7EresourceType%7E%28equals%7E%28%7E%27AI_GUARDRAIL%7E%27AI_AGENT%7E%27AI_MODEL%29%29%7Erisk%7E%28includesAny%7E%28%7E%27wct-id-1998%29%29%7Esearch%7E%28contains%7E%27LLM*20Bedrock*20guardrail*20prompt*20injection*20AI*20agent*20model%29%29%29)

Here is the enriched table view of all **29 AI problems and toxic combinations**, now with compliance framework context layered in for granular criticality assessment.

---

## 📊 Compliance Framework Context (AI Frameworks)

| Framework | Score | Key Insight |
|------------|------------|------------|
| OWASP ML Security Top 10 | **99%** ✅ | Strong ML posture |
| OWASP Agentic Applications 2026 | **98%** ✅ | Minor gaps in ASI03/ASI02 |
| OWASP LLM Security Top 10 | **97%** ✅ | Minor gaps in LLM06 Excessive Agency |
| **5Rs — Wiz for Data Security** | **53%** 🔴 | **Critical gap** — data exposure on AI assets severely under-controlled |

> ⚠️ The 53% score on 5Rs is the most significant compliance gap and **amplifies the criticality** of all issues involving sensitive data access below.

---

## 🔴 Adjusted Criticality: HIGH (Wiz MEDIUM + 5Rs 53% amplifier + multi-framework overlap)

These issues are rated MEDIUM by Wiz natively, but the **5Rs score of 53%** confirms that data exposure controls are broadly insufficient — making sensitive data access by AI agents a materially higher risk.

---

### Group 1 — AWS Bedrock: Model Invocation Without Guardrails (8 issues)

| # | Asset | Type | Cloud | Account | Rule | Justification | OWASP LLM | OWASP Agentic | 5Rs | Parent Projects |
|------------|------------|------------|------------|------------|------------|------------|------------|------------|------------|------------|
| 1 | `Allow model invoke without Guardrail for user or role` `AWSReservedSSO_FinanceAdmin_REDACTEDHASH` | IAM Role | AWS | aws-account-prod-01 | No guardrail on Bedrock invocation | No content filtering, data protection, or compliance enforcement on AI model calls. GDPR/CCPA violation risk. | LLM06 Excessive Agency, LLM02 Sensitive Info Disclosure | ASI02 Tool Misuse, ASI03 Identity Abuse | Restrict (missing) | PROJECT-ALPHA |
| 2–8 | 7 more `AWSReservedSSO_FinanceAdmin` roles | IAM Role | AWS | Various | Same as above | Same risk pattern across multiple AWS accounts | LLM06, LLM02 | ASI02, ASI03 | Restrict | PROJECT-ALPHA |

---

### Group 2 — GCP Managed AI Agents: High Privileges + Sensitive Data (13 issues)

| # | Asset | Region | Cloud Account | Rule | Justification | OWASP LLM | OWASP Agentic | OWASP ML | 5Rs | Parent Projects |
|------------|------------|------------|------------|------------|------------|------------|------------|------------|------------|------------|
| 9 | `Managed AI Agent with high privileges or sensitive data access` `Agent-A` | europe-west1 | gcp-account-01 | Managed agent with IAM access to sensitive data | Prompt injection → PII/credential exfiltration. 5Rs gap confirms data not restricted. | LLM06, LLM01 Prompt Injection | ASI03 Identity Abuse, ASI01 Goal Hijack | Data Poisoning | Restrict | PROJECT-BETA, PROJECT-ALPHA, gcp-account-01 |
| 10 | `Managed AI Agent with high privileges or sensitive data access` `Agent-B` | us-west1 | gcp-account-01 | Same | Same risk — FCR agent with over-privileged IAM | LLM06, LLM01 | ASI03, ASI01 | Data Poisoning | Restrict | PROJECT-BETA, PROJECT-ALPHA, gcp-account-01 |
| 11 | `Managed AI Agent with high privileges or sensitive data access` `AGENT_AUTOGEN_DO_NOT_DELETE` | us-west1 | gcp-account-01 | Same | Auto-generated agent — likely forgotten, still over-privileged | LLM06, LLM07 System Prompt Leakage | ASI10 Rogue Agents | Supply Chain | Restrict | PROJECT-BETA, PROJECT-ALPHA, gcp-account-01 |
| 12 | `Managed AI Agent with high privileges or sensitive data access` `dev-agent-D-test` | europe-west3 | gcp-account-02 | Same | Dev/test agent with prod-level IAM — violates least privilege | LLM06, LLM04 Data Poisoning | ASI03, ASI06 Memory Poisoning | Data Poisoning | Reconfigure | PROJECT-BETA, PROJECT-ALPHA |
| 13 | `Managed AI Agent with high privileges or sensitive data access` `dev-agent-D` | europe-west3 | gcp-account-02 | Same | Dev agent with excessive IAM — training data exposure risk | LLM06, LLM04 | ASI03, ASI06 | Data Poisoning | Reconfigure | PROJECT-BETA, PROJECT-ALPHA |
| 14 | `Managed AI Agent with high privileges or sensitive data access` `Agent-E` | us-west1 | gcp-account-03 | Same | Innovation agent with sensitive data access — no guardrail | LLM06, LLM02 | ASI03, ASI01 | Input Manipulation | Restrict | PROJECT-ALPHA, PROJECT-GAMMA |
| 15 | `Managed AI Agent with high privileges or sensitive data access` `agent-F` | europe-west4 | — | Same | Pricing agent with financial data access — high business impact | LLM06, LLM02 | ASI03, ASI02 | Model Theft | Restrict | PROJECT-ALPHA |
| 16 | `Managed AI Agent with high privileges or sensitive data access` `agent-F-preprod` | europe-west4 | — | Same | Pre-prod pricing agent — same risk as prod | LLM06, LLM02 | ASI03, ASI02 | Model Theft | Reconfigure | PROJECT-ALPHA |
| 17 | `Managed AI Agent with high privileges or sensitive data access` `Agent-G` | europe-west4 | — | Same | Business partner data agent — PII/partner data exposure risk | LLM06, LLM02 | ASI03, ASI01 | Data Poisoning | Restrict | PROJECT-ALPHA |
| 18 | `Managed AI Agent with high privileges or sensitive data access` `Agent-G` (dup) | europe-west4 | — | Same | Duplicate instance — same risk | LLM06, LLM02 | ASI03 | Data Poisoning | Restrict | PROJECT-ALPHA |
| 19–21 | `Managed AI Agent with high privileges or sensitive data access` `AGENT_AUTOGEN_DO_NOT_DELETE` (×3) | us-west1 | gcp-account-01 | Same | 3 auto-generated agents — forgotten/orphaned, still privileged | LLM06, LLM07 | ASI10 Rogue Agents | Supply Chain | Reduce + Restrict | PROJECT-BETA, PROJECT-ALPHA, gcp-account-01 |

---

### Group 3 — GCP Hosted AI Agents on VM/Serverless: High Privileges + Sensitive Data (6 issues)

| # | Asset | Region | Cloud Account | Rule | Justification | OWASP LLM | OWASP Agentic | 5Rs | Parent Projects |
|------------|------------|------------|------------|------------|------------|------------|------------|------------|------------|
| 22–25 | `AI Agent hosted on VM/serverless with high privileges or sensitive data access` `agent-I` (×4) | europe-west4 | gcp-account-04 | Hosted agent on VM with excessive IAM | Inactive agents still holding sensitive data access — lateral movement risk via compromised compute | LLM06, LLM01 | ASI03, ASI05 RCE | Restrict + Reduce | PROJECT-ALPHA, PROJECT-ZETA |
| 26–27 | `AI Agent hosted on VM/serverless with high privileges or sensitive data access` `agent-H-chatbot` (×2) | europe-west1 | gcp-account-05 / gcp-account-06 | Same | Chatbot agent on serverless with excessive IAM — user-facing attack surface | LLM06, LLM02, LLM05 Improper Output | ASI02 Tool Misuse, ASI03 | Restrict | PROJECT-ALPHA, PROJECT-DELTA, PROJECT-EPSILON |

---

### Group 4 — GCP AI Agents: Overly Permissive Execution Identity (2 issues — LOW)

| # | Asset | Region | Cloud Account | Rule | Justification | OWASP Agentic | 5Rs | Parent Projects |
|---|---|---|---|---|---|---|---|
| 28 | `AI resource using overly permissive execution identity` `agent-J` | europe-west1 | gcp-account-07 | Overly permissive execution identity | Latent privileges — if compromised via prompt injection → RCE/SSRF, attacker inherits all permissions | ASI03 Identity Abuse | Reconfigure | PROJECT-BETA, PROJECT-ALPHA |
| 29 | `AI resource using overly permissive execution identity` `agent-K` | europe-west1 | gcp-account-07 | Same | Same risk pattern | ASI03 | Reconfigure | PROJECT-BETA, PROJECT-ALPHA |

---

## 📋 Adjusted Criticality Summary

| Adjusted Priority | Count | Wiz Native Severity | Amplifier | Key Frameworks |
|------------|------------|------------|------------|------------|
| 🔴 **Elevated-Medium** (treat as High) | 27 | MEDIUM | 5Rs = 53% + multi-framework overlap | LLM06, ASI03, ASI02, Restrict/Reconfigure |
| 🟡 **Medium** | 2 | LOW | Latent privilege risk | ASI03, Reconfigure |

> **Bottom line:** The 5Rs score of **53%** is the critical amplifier. It confirms that data restriction and reconfiguration controls are broadly failing across your AI estate — meaning the "MEDIUM" Wiz severity on all 27 issues should be treated as **effectively HIGH** from a compliance and data governance perspective. The dominant parent project across all issues is **PROJECT-ALPHA**.