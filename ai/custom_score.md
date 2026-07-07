his is a great strategic direction. Here's a proposed AI Asset Risk Score (AARS) framework built from your actual environment data, combining toxic combination participation, compliance framework signals, and data exposure context.

🧠 Proposed: AI Asset Risk Score (AARS)
Scoring Philosophy
The score is built on 3 pillars, each contributing a weighted component:

Pillar	Weight	Source
A — Toxic Combination Participation	50%	Number & severity of open issues per asset
B — Compliance Framework Gaps	30%	Failing controls across OWASP LLM, Agentic, ML, 5Rs
C — Data Exposure Context	20%	5Rs score (53%) as a systemic multiplier
Pillar A — Toxic Combination Score (0–50 pts)
Condition	Points
Asset has ≥1 CRITICAL toxic combination issue	50
Asset has ≥1 HIGH toxic combination issue	35
Asset has ≥1 MEDIUM toxic combination issue	20
Asset has ≥1 LOW toxic combination issue	8
Asset has 0 issues	0
Multiplier: Asset appears in >1 toxic combination	×1.2 (capped at 50)
Pillar B — Compliance Framework Gap Score (0–30 pts)
Condition	Points
Asset maps to a failing OWASP LLM control (any severity)	+10
Asset maps to a failing OWASP Agentic control	+10
Asset maps to a failing OWASP ML control	+5
Asset maps to a failing 5Rs control	+5
Asset has no guardrail attached (LLM01/ASI01 gap)	+10
Asset uses deprecated model (e.g., text-embedding-005)	+5
Pillar C — Data Exposure Multiplier (0–20 pts)
Based on the 5Rs score of 53% as a systemic signal:

Condition	Points
Asset has confirmed access to sensitive data (PII/PHI/PCI)	+20
Asset has access to data resources (unconfirmed sensitivity)	+10
Asset has no data access	0
Global multiplier: 5Rs = 53% → apply ×1.1 to all data-related scores	×1.1
AARS Score Bands
Score	Risk Level	Action
70–100	🔴 CRITICAL	Immediate remediation required
50–69	🟠 HIGH	Remediate within 7 days
30–49	🟡 MEDIUM	Remediate within 30 days
10–29	🔵 LOW	Monitor and review quarterly
0–9	✅ MINIMAL	No action required
📊 Applied AARS — Your AI Assets (Top Scored)
Asset	Toxic Issues	Compliance Gaps	Data Exposure	AARS Score	Risk Level	Parent Project
Agent-A	MEDIUM ×1 (20)	LLM06 gap +10, No guardrail +10	Sensitive data ×1.1 = +22	62	🟠 HIGH	PROJECT-BETA, PROJECT-ALPHA, gcp-account-01
Agent-B	MEDIUM ×1 (20)	LLM06 gap +10, No guardrail +10	Sensitive data ×1.1 = +22	62	🟠 HIGH	PROJECT-BETA, PROJECT-ALPHA, gcp-account-01
Agent-G ×2	MEDIUM ×2 ×1.2 (24)	LLM06 +10, No guardrail +10	Sensitive data ×1.1 = +22	66	🟠 HIGH	PROJECT-ALPHA
agent-F	MEDIUM ×1 (20)	LLM06 +10, No guardrail +10	Sensitive data ×1.1 = +22	62	🟠 HIGH	PROJECT-ALPHA
agent-F-preprod	MEDIUM ×1 (20)	LLM06 +10, No guardrail +10	Sensitive data ×1.1 = +22	62	🟠 HIGH	PROJECT-ALPHA
agent-H-chatbot ×2	MEDIUM ×2 ×1.2 (24)	LLM06 +10, LLM05 +5, No guardrail +10	Sensitive data ×1.1 = +22	71	🔴 CRITICAL	PROJECT-ALPHA, PROJECT-DELTA, PROJECT-EPSILON
agent-I ×4	MEDIUM ×4 ×1.2 (24)	LLM06 +10, No guardrail +10	Sensitive data ×1.1 = +22	66	🟠 HIGH	PROJECT-ALPHA, PROJECT-ZETA
AGENT_AUTOGEN_DO_NOT_DELETE ×3	MEDIUM ×3 ×1.2 (24)	LLM06 +10, ASI10 Rogue +10, No guardrail +10	Sensitive data ×1.1 = +22	76	🔴 CRITICAL	PROJECT-BETA, PROJECT-ALPHA, gcp-account-01
dev-agent-D	MEDIUM ×1 (20)	LLM04 +5, LLM06 +10, No guardrail +10	Sensitive data ×1.1 = +22	67	🟠 HIGH	PROJECT-BETA, PROJECT-ALPHA
dev-agent-D-test	MEDIUM ×1 (20)	LLM04 +5, LLM06 +10, No guardrail +10	Sensitive data ×1.1 = +22	67	🟠 HIGH	PROJECT-BETA, PROJECT-ALPHA
Agent-E	MEDIUM ×1 (20)	LLM06 +10, No guardrail +10	Sensitive data ×1.1 = +22	62	🟠 HIGH	PROJECT-ALPHA, PROJECT-GAMMA
AWSReservedSSO_FinanceAdmin ×8	MEDIUM ×8 ×1.2 (24)	LLM01 +10, LLM02 +10, ASI02 +10	Data access ×1.1 = +11	65	🟠 HIGH	PROJECT-ALPHA
agent-J	LOW ×1 (8)	ASI03 +10	Data access ×1.1 = +11	29	🔵 LOW	PROJECT-BETA, PROJECT-ALPHA
agent-K	LOW ×1 (8)	ASI03 +10	Data access ×1.1 = +11	29	🔵 LOW	PROJECT-BETA, PROJECT-ALPHA
💡 How to Operationalize This in Wiz
This scoring model can be implemented today using existing Wiz capabilities:

Capability	How to use
Custom Compliance Framework	Create a custom framework in Wiz mapping AARS pillars to controls — score per project
Posture Policies	Create policies for each pillar condition (no guardrail, sensitive data access, deprecated model)
Issues + Toxic Combinations	Already tracked — use issue count per asset as Pillar A input
5Rs Framework	Already enabled at 53% — use as systemic multiplier
Project-level scoring	Group assets by parent project (PROJECT-ALPHA, PROJECT-BETA, etc.) to get project-level AARS
Immediate recommendation: AGENT_AUTOGEN_DO_NOT_DELETE (×3, score 76 🔴) and agent-H-chatbot (×2, score 71 🔴) are your highest-risk assets. Both are auto-generated or chatbot agents with no guardrails, multiple toxic combination instances, and confirmed sensitive data access — they should be prioritized for remediation or decommissioning.






Looking for results from graph search...

[Security Graph](https://app.wiz.io/explorer/graph#%7E%28query%7E%28select%7Etrue%7Etype%7E%28%7E%27AI_AGENT%29%7Ewhere%7E%28name%7E%28EQUALS%7E%28%7E%27Agent-A%7E%27agent-H-chatbot%7E%27agent-I%7E%27AGENT_AUTOGEN_DO_NOT_DELETE%7E%27agent-F%7E%27Agent-G%7E%27Agent-E%7E%27dev-agent-D%7E%27Agent-B%29%29%7EpublicAccessTypes%7E%28IS_SET%7Etrue%29%29%29%29)





Here is the updated **AARS table with internet exposure** added as a column. Based on the data retrieved:

- **Managed GCP ReasoningEngine agents** (`aiplatform#ReasoningEngine`): all show `isAccessibleFromInternet: false` — they are **not directly internet-exposed**
- **Hosted agents** (`hostedAiAgent`) — `agent-H-chatbot`, `agent-I`: `isAccessibleFromInternet: null` — exposure **cannot be determined** from the agent entity itself (it depends on the underlying compute/container exposure)
- **AWS IAM roles** (`AWSReservedSSO_FinanceAdmin`): not applicable for direct internet exposure

---

## 📊 Updated AARS Table — With Internet Exposure

| Asset | Toxic Issues | Compliance Gaps | Data Exposure | Internet Exposed | **AARS Score** | **Risk Level** | Parent Projects |
|---|---|---|---|---|---|---|---|
| `AGENT_AUTOGEN_DO_NOT_DELETE` ×3 | MEDIUM ×3 ×1.2 (24) | LLM06 +10, ASI10 Rogue +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ❌ No | **76** | 🔴 CRITICAL | PROJECT-BETA, PROJECT-ALPHA, gcp-account-01 |
| `agent-H-chatbot` ×2 | MEDIUM ×2 ×1.2 (24) | LLM06 +10, LLM05 +5, No guardrail +10 | Sensitive data ×1.1 = +22 | ⚠️ Unknown (hosted on serverless) | **71** | 🔴 CRITICAL | PROJECT-ALPHA, PROJECT-DELTA, PROJECT-EPSILON |
| `Agent-G` ×2 | MEDIUM ×2 ×1.2 (24) | LLM06 +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ❌ No | **66** | 🟠 HIGH | PROJECT-ALPHA, PROJECT-ETA |
| `agent-I` ×4 | MEDIUM ×4 ×1.2 (24) | LLM06 +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ⚠️ Unknown (hosted on VM, Inactive) | **66** | 🟠 HIGH | PROJECT-ALPHA, PROJECT-ZETA |
| `dev-agent-D-test` | MEDIUM ×1 (20) | LLM04 +5, LLM06 +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ❌ No | **67** | 🟠 HIGH | PROJECT-BETA, PROJECT-ALPHA |
| `dev-agent-D` | MEDIUM ×1 (20) | LLM04 +5, LLM06 +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ❌ No | **67** | 🟠 HIGH | PROJECT-BETA, PROJECT-ALPHA |
| `Agent-A` | MEDIUM ×1 (20) | LLM06 +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ❌ No | **62** | 🟠 HIGH | PROJECT-BETA, PROJECT-ALPHA, gcp-account-01 |
| `Agent-B` | MEDIUM ×1 (20) | LLM06 +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ❌ No | **62** | 🟠 HIGH | PROJECT-BETA, PROJECT-ALPHA, gcp-account-01 |
| `agent-F` | MEDIUM ×1 (20) | LLM06 +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ❌ No | **62** | 🟠 HIGH | PROJECT-ALPHA |
| `agent-F-preprod` | MEDIUM ×1 (20) | LLM06 +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ❌ No | **62** | 🟠 HIGH | PROJECT-ALPHA |
| `Agent-E` | MEDIUM ×1 (20) | LLM06 +10, No guardrail +10 | Sensitive data ×1.1 = +22 | ❌ No | **62** | 🟠 HIGH | PROJECT-ALPHA, PROJECT-GAMMA |
| `AWSReservedSSO_FinanceAdmin` ×8 | MEDIUM ×8 ×1.2 (24) | LLM01 +10, LLM02 +10, ASI02 +10 | Data access ×1.1 = +11 | N/A (IAM role) | **65** | 🟠 HIGH | PROJECT-ALPHA |
| `agent-J` | LOW ×1 (8) | ASI03 +10 | Data access ×1.1 = +11 | ❌ No | **29** | 🔵 LOW | PROJECT-BETA, PROJECT-ALPHA |
| `agent-K` | LOW ×1 (8) | ASI03 +10 | Data access ×1.1 = +11 | ❌ No | **29** | 🔵 LOW | PROJECT-BETA, PROJECT-ALPHA |

---

### Internet Exposure Legend

| Symbol | Meaning |
|---|---|
| ❌ No | `isAccessibleFromInternet: false` — confirmed not internet-exposed |
| ⚠️ Unknown | `isAccessibleFromInternet: null` — hosted agent on compute/container; exposure depends on the underlying infrastructure (Cloud Run, VM). Needs further investigation. |
| N/A | IAM role — not applicable for network exposure |

---

### Key Note on `agent-H-chatbot` and `agent-I`

Both are **hosted agents** (`hostedAiAgent`) running on Cloud Run serverless (`agent-H-chatbot`) and VMs (`agent-I`). Their internet exposure is **inherited from the host compute**, not tracked directly on the agent entity. Since `agent-H-chatbot` runs on Cloud Run (a public-by-default GCP service), it is **likely internet-accessible** — this warrants a dedicated network exposure check on the underlying Cloud Run service.

> **Good news overall:** No AI agents in your environment are confirmed as directly internet-exposed. However, the `⚠️ Unknown` status on hosted agents means the risk cannot be fully ruled out without checking the underlying compute exposure.

[Cloud Resources](https://app.wiz.io/inventory/cloud-resources#%7E%28filters%7E%28isAccessibleFromInternet%7E%28equals%7Etrue%29%7EresourceType%7E%28equals%7E%28%7E%27AI_AGENT%29%29%29%29)

[Cloud Resources](https://app.wiz.io/inventory/cloud-resources#%7E%28filters%7E%28name%7E%28hasPart%7E%28%7E%27Agent-A%7E%27agent-H-chatbot%7E%27agent-I%7E%27AGENT_AUTOGEN%7E%27agent-F%7E%27Agent-G%7E%27Agent-E%7E%27dev-agent-D%7E%27Agent-B%7E%27agent-J%7E%27agent-K%29%29%7EresourceType%7E%28equals%7E%28%7E%27AI_AGENT%29%29%29%29)