Based on everything we've built in this conversation, here's a summary of the **security graph queries** needed to populate each column of the AARS table:

---

## 🔍 Security Graph Queries for AARS Table

### 1. 📦 AI Asset Discovery (Base Inventory)
**Purpose:** Find all AI agents to populate the table rows

```
AI Agents (all types)
→ filter: type = AI_AGENT
→ return: name, nativeType, region, cloudAccount, status, projects
```
- Covers: `aiplatform#ReasoningEngine`, `hostedAiAgent`
- Also run for: `AI_MODEL`, `MCP_SERVER`, `AI_GUARDRAIL`, `AI_PIPELINE`

---

### 2. ☠️ Toxic Combination Participation (Pillar A)
**Purpose:** Count open issues per asset and identify which rules triggered

```
AI Agent → HAS_ISSUE → Risk Issue
→ filter: issue.status = OPEN, issue.type = TOXIC_COMBINATION
→ return: asset.name, issue.severity, issue.sourceRule.id, issue.sourceRule.name
```
Key rules to track:
- `wc-id-3217` — Managed AI Agent with high privileges or sensitive data access
- `wc-id-3230` — AI Agent hosted on VM/serverless with high privileges or sensitive data access
- `wc-id-2742` — Allow model invoke without Guardrail for user or role
- `wc-id-3123` — AI resource using overly permissive execution identity

---

### 3. 🔐 Sensitive Data Access (Pillar C)
**Purpose:** Determine if the agent's execution identity has access to sensitive data resources

```
AI Agent → RUNS_AS → Service Account
→ Service Account → HAS_PERMISSION → Data Resource
→ filter: dataResource.hasSensitiveData = true OR dataResource.dataFindingSeverity IN [CRITICAL, HIGH]
→ return: agent.name, serviceAccount.name, dataResource.name, dataResource.type
```

Also:

```
AI Agent → USES_DATASET → AI Dataset
→ AI Dataset → STORED_IN → Bucket
→ filter: bucket.hasSensitiveData = true
→ return: agent.name, dataset.name, bucket.name, bucket.dataFindingSeverity
```

---

### 4. 🛡️ Guardrail Coverage (Compliance Gap — Pillar B)
**Purpose:** Identify AI agents with no guardrail attached

```
AI Agent
→ NOT (AI Agent → HAS_GUARDRAIL → AI Guardrail)
→ filter: agent.type = AI_AGENT
→ return: agent.name, agent.cloudPlatform, agent.projects
```

Also for AWS Bedrock specifically:

```
IAM Role → CAN_INVOKE → AI Model (Bedrock)
→ NOT (invocation → ENFORCES → AI Guardrail)
→ return: role.name, model.name, account
```

---

### 5. 🌐 Internet Exposure (New Column)
**Purpose:** Determine if the agent or its host compute is internet-accessible

**For managed agents (ReasoningEngine):**

```
AI Agent
→ filter: isAccessibleFromInternet = true OR isOpenToAllInternet = true
→ return: agent.name, exposureLevel
```

**For hosted agents (on VM/serverless/container):**

```
AI Agent (hostedAiAgent) → HOSTED_ON → Virtual Machine / Serverless / Container
→ Virtual Machine / Serverless → HAS_NETWORK_EXPOSURE → Internet
→ filter: exposure.type = PUBLIC_INTERNET
→ return: agent.name, host.name, host.type, exposure.ports
```

**For Cloud Run specifically (agent-H-chatbot):**

```
AI Agent → HOSTED_ON → Serverless (Cloud Run)
→ Serverless → IS_ACCESSIBLE_FROM → Internet
→ return: agent.name, cloudRunService.name, isPublic
```

---

### 6. 🔑 IAM Over-Privilege (Pillar A + C combined)
**Purpose:** Confirm the execution identity has excessive permissions

```
AI Agent → RUNS_AS → Service Account / IAM Role
→ Service Account → HAS_EXCESSIVE_ACCESS_FINDING → Excessive Access Finding
→ return: agent.name, serviceAccount.name, finding.unusedPermissions, finding.severity
```

---

### 7. 🧬 MCP Server Risk (for agents using remote MCP)
**Purpose:** Identify agents connected to remote/untrusted MCP servers

```
AI Agent → USES_TOOL → MCP Server
→ filter: mcpServer.hostingType = REMOTE
→ AI Agent → HAS_ACCESS → Data Resource (sensitive)
→ return: agent.name, mcpServer.name, mcpServer.hostingType, dataResource.name
```

---

### 8. 🏗️ Supply Chain Risk (OWASP LLM03 / ASI04)
**Purpose:** Detect agents built from repositories with malicious packages

```
AI Agent (hostedAiAgent) → BUILT_FROM → Container Image
→ Container Image → BUILT_FROM → Repository Branch
→ Repository Branch → HAS_FINDING → Software Management Finding
→ filter: finding.type = MALICIOUS_PACKAGE
→ return: agent.name, image.name, repo.name, finding.packageName
```

---

### 9. 🔄 Lateral Movement Risk (ASI03 / ASI05)
**Purpose:** Identify agents whose host has a lateral movement path to admin

```
AI Agent → HOSTED_ON → Virtual Machine
→ Virtual Machine → HAS_LATERAL_MOVEMENT_FINDING → Admin Role
→ return: agent.name, vm.name, lateralMovementPath, targetRole
```

---

## 📋 Summary Table — Query → AARS Column Mapping

| Query | AARS Column | Pillar |
|---|---|---|
| AI Asset Discovery | Asset name, type, region, account | Base |
| Toxic Combination Issues per asset | Issue count + severity | A (50%) |
| Sensitive data access via IAM | Data exposure flag | C (20%) |
| AI Dataset → Bucket with sensitive data | Data exposure flag | C (20%) |
| No guardrail attached | Compliance gap score | B (30%) |
| isAccessibleFromInternet on agent | Internet exposure | Bonus |
| Hosted agent → host compute → internet | Internet exposure (hosted) | Bonus |
| Excessive access finding on service account | Pillar A amplifier | A |
| Remote MCP server + sensitive data | Compliance gap | B |
| Malicious package in build chain | Supply chain gap | B |
| Lateral movement path from host | Risk amplifier | A+B |

> **Practical tip:** Most of these queries are already partially answered by the toxic combination rules (wc-id-3217, wc-id-3230, etc.) — those rules ARE the graph queries pre-packaged as controls. The additional value comes from running the raw graph queries to get **per-asset granularity** beyond what the issue grouping provides, especially for assets with **no current issues** that may still carry latent risk.



Good question. Looking at the 9 query categories we defined, here are **5 important gaps** worth adding:

---

## 🔍 Missing Query Categories

### 1. 🕵️ Shadow / Orphaned AI Assets
**Why it matters:** `AGENT_AUTOGEN_DO_NOT_DELETE` (your highest AARS score) is a perfect example — auto-generated agents that are forgotten but still hold active IAM permissions. No current query tracks **age + no recent activity + still privileged**.

```
AI Agent
→ filter: firstSeen > 90 days ago AND lastSeen < 30 days ago
→ AND: agent.status = Active
→ AND: serviceAccount.hasHighPrivileges = true OR hasSensitiveDataAccess = true
→ return: agent.name, firstSeen, lastSeen, serviceAccount.permissions
```
**Maps to:** OWASP Agentic ASI10 (Rogue Agents), 5Rs Reduce

---

### 2. 🔗 Agent-to-Agent / Multi-hop Trust Chains
**Why it matters:** In agentic architectures, one agent can invoke another. If Agent A is low-risk but calls Agent B which has admin privileges, the risk propagates. We haven't modeled **transitive trust**.

```
AI Agent (A) → INVOKES_TOOL → AI Agent (B)
→ filter: agentB.hasHighPrivileges = true OR agentB.hasSensitiveDataAccess = true
→ agentA.hasIssue = false (appears clean)
→ return: agentA.name, agentB.name, agentB.privileges, trust chain depth
```
**Maps to:** OWASP Agentic ASI07 (Insecure Inter-Agent Communication), ASI08 (Cascading Failures)

---

### 3. 📦 Model Integrity & Provenance
**Why it matters:** We track agents but not the **models they use**. A model tagged `deprecated` (like `text-embedding-005` in your env) or sourced from an unverified bucket is a supply chain risk that doesn't show up in agent-level queries.

```
AI Agent → USES_MODEL → AI Model
→ filter: model.status = DEPRECATED
   OR model.sourceLocation = PUBLIC_BUCKET
   OR model.tag["aiml-model-status"] NOT IN ["approved"]
→ return: agent.name, model.name, model.status, model.sourceLocation
```
**Maps to:** OWASP ML Security (Model Theft, Supply Chain), OWASP LLM03

---

### 4. 👤 Human Identity → AI Asset Access (Who can control the agent?)
**Why it matters:** We track what the **agent can access**, but not **who can access or modify the agent itself**. A developer with write access to an agent's configuration or source bucket is a critical attack vector we haven't covered.

```
Human User / Service Account → HAS_PERMISSION → AI Agent
→ filter: permission.type IN [WRITE, ADMIN, DELETE]
→ AND: user.mfaEnabled = false OR user.isInactive = true
→ return: user.name, user.mfaStatus, agent.name, permission.type
```
**Maps to:** OWASP Agentic ASI03 (Identity & Privilege Abuse), ISO 42001 A.9 (Use of AI systems)

---

### 5. 🧪 Code-to-Cloud Traceability (Is the agent's code auditable?)
**Why it matters:** For hosted agents (`agent-H-chatbot`, `agent-I`, `agent-L`), we don't know if the **source code has been SAST-scanned**, if it contains prompt injection vulnerabilities, or if it was built from a public/unreviewed repository. This is the gap between runtime risk and build-time risk.

```
AI Agent (hostedAiAgent) → BUILT_FROM → Container Image
→ Container Image → BUILT_FROM → Repository Branch
→ filter: repositoryBranch.lastSASTScan = null
   OR repositoryBranch.hasPromptInjectionFinding = true
   OR repositoryBranch.codeRepository.isPublic = true
→ return: agent.name, repo.name, repo.isPublic, lastSASTScan, promptInjectionFindings
```
**Maps to:** OWASP LLM01 (Prompt Injection), OWASP Agentic ASI04 (Supply Chain), Wiz for Code & Supply Chain Security

---



---

**Priority order for adding these:**
1. **#14 Human Identity → AI control** — highest immediate risk, directly exploitable
2. **#11 Shadow/Orphaned assets** — already proven relevant (`AGENT_AUTOGEN_DO_NOT_DELETE`)
3. **#13 Model provenance** — `text-embedding-005` deprecated model already in your env
4. **#15 Code-to-Cloud SAST** — relevant for `agent-H-chatbot` and hosted agents
5. **#12 Agent-to-Agent chains** — most complex, requires agentic architecture mapping