# Realy — Intelligence Layer & Agent Runtime

> Status: **Architecture frozen; implementation Phase 3–4.**

## 1. One runtime, many employees

There is exactly **one** agent runtime (`src/server/modules/agents/runtime`). A digital employee is a
row in `agents` — a configuration — never a separate codebase:

```ts
interface AgentConfig {
  id: string; organizationId: string; companyId: string;
  key: string;                 // "cmo", "seo-specialist"
  role: string; department: Department;
  instructions: string;        // company-editable, versioned
  skills: SkillRef[];          // prompt modules + evaluation rubrics
  tools: ToolName[];           // allow-list (intersected with RBAC + policy at call time)
  principal: { type: 'AGENT', id: string };   // RBAC identity
  memoryScope: MemoryScope;    // which memories it can read/write
  knowledgeScope: KnowledgeScope; // which knowledge sources (ACL-filtered retrieval)
  budget: { maxCostMinorPerTask: bigint; maxCostMinorPerDay: bigint; currency: string; maxTokensPerTask: number };
  approvalPolicy: ApprovalPolicy;  // may only tighten tool autonomy levels
  modelPolicy: { tier: 'fast' | 'balanced' | 'frontier'; providers?: Provider[] };
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
}
```
Templates for the initial workforce (Executive, Product, Engineering, Marketing, Sales, Finance,
Operations, Customer, Intelligence, Legal/Compliance Ops — ~70 roles) ship as versioned JSON in
`src/server/modules/agents/templates/`. Hiring an employee = instantiating a template for a company
(creating the config row + its AGENT principal + scoped role assignment). Phase 4 launches ~20;
expansion to 100+ is data, not code.

## 2. Run lifecycle (state machine)

```
IDLE → TASK_RECEIVED → CONTEXT_LOAD → PLAN → TOOL_REQUEST → PERMISSION_CHECK → EXECUTION → OBSERVE → VERIFY → COMPLETE
                                         ↑_________________________________________________|  (next step)
side states: WAITING · APPROVAL_REQUIRED · RETRYING · ESCALATED · FAILED · CANCELLED
```
* Each transition is persisted (`task_runs.state`, `executions` rows) and emitted as an event, so a
  worker crash resumes from the last durable state (runs are BullMQ jobs with the run id as job id).
* **Hard limits** (all enforced by the runtime, not the model): `maxIterations` (default 25),
  wall-clock timeout (default 15 min per run, longer only for sandboxed engineering tasks), token and
  cost budget (checked before each model/tool call using estimated cost; exceeded → `ESCALATED`),
  retry policy per tool (exponential backoff, max 3, only for idempotent/retryable errors),
  per-provider circuit breakers, cancellation tokens checked between every step, company kill switch.
  There is no code path that loops without decrementing an iteration budget.
* `APPROVAL_REQUIRED` persists an `approvals` row and parks the run; approval/rejection events
  resume it. Approvals expire (default 72 h) → `CANCELLED` with notification.
* `ESCALATED` creates a founder-visible item with the agent's summary, what it tried, and why it stopped.

## 3. Intelligence layer (orchestrator)

| Component | Responsibility |
|---|---|
| Context Engine | assembles authorized context: company profile, graph neighborhood (SQL over relations + `graph_edges`), relevant knowledge chunks (pgvector, ACL-filtered, with citations), recent events, objective state. Token-budgeted with summarization/compression. |
| Planning Engine | objective → plan → milestones → tasks with dependencies, owners (agent roles), success criteria, budget, risk. Plans are persisted and versioned; the founder can edit before activation. |
| Task Decomposition | breaks tasks into tool-sized subtasks; assigns by role capabilities & load. |
| Decision Engine | chooses between options with explicit rationale stored in `decisions` (auditable). |
| Memory | per-company long-term memory (facts, decisions, preferences) + per-agent working memory, both permission-scoped. |
| Retrieval | hybrid: relational queries + graph traversal + vector similarity + keyword (Postgres FTS), with reranking. |
| Tool Selection | constrained to the agent's allowed tools; model proposes, gateway disposes. |
| Execution Monitoring | streams state to the Command Center via SSE. |
| Result Evaluation | verifier step per task: checks success criteria with deterministic checks where possible (tests pass, record exists, email sent id) and model-graded rubric otherwise. |
| Error Recovery | classify failure → retry / replan / escalate. |
| Objective Tracking | rolls task outcomes up to milestone/objective progress and metrics. |

North-star flow — "Launch my company in the UK within 60 days": understand → inspect context →
identify missing info (asks the founder) → research → strategy → milestones → tasks → assign workforce →
request approvals → execute → verify → measure → optimize → report.

## 4. Model provider abstraction

```ts
interface ModelProvider {
  id: 'anthropic' | 'openai' | 'google';
  generate(req: GenerateRequest): Promise<GenerateResult>;   // messages, tools (JSON schema), response schema
  stream(req: GenerateRequest): AsyncIterable<StreamEvent>;
  embed?(input: string[]): Promise<number[][]>;
  estimateCost(req): Money;
}
```
* **Model routing** by tier: `fast` (classification, extraction, routing), `balanced` (most agent
  steps), `frontier` (planning, complex reasoning, code). Default mapping per tier is configuration
  (e.g. Anthropic `claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*`, with OpenAI and Gemini
  equivalents as fallbacks). No model id is hard-coded in business logic.
* Fallback chain on provider errors/overload; per-company provider allow-list (data residency,
  enterprise contracts).
* Cost control: token budgets per company/agent/task, prompt caching for stable prefixes
  (system + company instructions), context compression, response caching for deterministic
  sub-queries, usage written to `usage_records` (`ai.input_tokens`, `ai.output_tokens`, `ai.cost_minor`).

## 5. Observability
OpenTelemetry span per run and per step (`agent.run`, `agent.step`, `model.generate`, `tool.call`)
with attributes: org, company, agent, tokens, cost, latency, outcome. Metrics: success rate,
escalation rate, cost per task, tool failure rate, approval latency.
