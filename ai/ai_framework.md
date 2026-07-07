

Here are all compliance frameworks related to AI (entirely or partially), across your tenant:

---

## 🤖 Pure AI Frameworks (Type: AI)

| Framework | ID | Status | Controls | CCRs | Categories |
|---|---|---|---|---|---|
| **OWASP LLM Security Top 10** | `wf-id-201` | ✅ Enabled | 72 | 49 | LLM01–LLM10 (2025) |
| **OWASP ML Security Top 10** | `wf-id-106` | ✅ Enabled | 24 | 24 | Data Poisoning, Model Theft, Input Manipulation, Supply Chain, Output Integrity |
| **OWASP Top 10 For Agentic Applications 2026** | `wf-id-275` | ✅ Enabled | 53 | 27 | ASI01–ASI10 (Agent Hijack, Tool Misuse, Identity Abuse, RCE, Rogue Agents…) |
| **ISO 42001:2023 (AI)** | `wf-id-166` | ❌ **Disabled** | 51 | 29 | AI Policies, Data for AI, AI Lifecycle, Third-party AI relationships |

---

## 🗄️ Data Security Frameworks (partially AI-relevant)

| Framework | ID | Status | Controls | CCRs | Categories |
|---|---|---|---|---|---|
| **5Rs — Wiz for Data Security** | `wf-id-214` | ✅ Enabled | 131 | 27 | Reduce, Restrict, Relabel, Relocate, Reconfigure |
| **Data Security Score Framework [Company]** | `<redacted-id>` | ✅ Enabled (Custom) | 90 | 42 | Data GDPR compliance, Data Security framework compliance |
| **Wiz for Data Security (Legacy)** | `wf-id-169` | ❌ Disabled | 457 | 147 | Data Risk, Access Governance, Key/Secret Mgmt, DDR, Cost Optimization |

---

## 🔐 OWASP Frameworks (partially AI-relevant)

| Framework | ID | Status | Controls | CCRs | Notes |
|---|---|---|---|---|---|
| **OWASP CI/CD Top 10** | `wf-id-176` | ✅ Enabled | 94 | 43 | Covers AI-powered CI/CD pipeline risks (PPE, supply chain) |
| **OWASP API Security Top 10** | `wf-id-215` | ✅ Enabled | 2 | 0 | Relevant for AI inference API endpoints |
| **OWASP Kubernetes Top 10** | `wf-id-112` | ❌ Disabled | 22 | 54 | Relevant for AI workloads on K8s |
| **OWASP Top 10 2021** | `wf-id-238` | ✅ Enabled | 0 | 0 | No controls mapped yet |
| **OWASP Top 10 2025** | `wf-id-258` | ❌ Disabled | 0 | 0 | No controls mapped yet |

---

## 🏗️ Wiz Standards (partially AI-relevant)

| Framework | ID | Status | Controls | CCRs | Notes |
|---|---|---|---|---|---|
| **Wiz for Code & Supply Chain Security** | `wf-id-175` | ✅ Enabled | 245 | 114 | Covers AI-powered CI workflows, code security |
| **Wiz for Container & Kubernetes Security** | `wf-id-199` | ✅ Enabled | 433 | 279 | Relevant for containerized AI agents/models |

---

## Summary & Recommendations

| Priority | Action |
|---|---|
| 🔴 Enable | **ISO 42001:2023** — the only AI management system standard, currently disabled (51 controls, 29 CCRs) |
| 🟡 Review | **OWASP Agentic Applications 2026** — enabled but check your score, directly maps to your toxic combination issues (ASI03 Identity & Privilege Abuse, ASI02 Tool Misuse) |
| 🟡 Review | **OWASP ML Security Top 10** — enabled, check score for Data Poisoning and Model Theft categories |
| 🔵 Consider | **OWASP Kubernetes Top 10** — disabled, relevant if AI workloads run on K8s clusters |