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
* **Hard limits as implemented** (`packages/backend/src/server/modules/agents/runtime.ts`; enforced by the runtime,
  not the model): the profile's `maxTurns` (8 for most roles, at most 15 for a company-defined role) per task — the
  turn counter carries over when a parked run resumes, so parking never adds turns; a 5-minute wall-clock deadline per
  execution (`DEADLINE_MS`); the AI employee's remaining monthly token allowance (`tokenCeiling`); cost budgets
  (task / AI employee / department / company, `checkSpend` before every model call, hard stop); at most 4 model
  calls per turn across the fallback chain; per-provider/model circuit breakers shared across workers through Redis;
  a cancellation check before every model call; the company kill switch ("Pause all AI") and the platform controls
  before the run starts and on every tool call. There is no code path that loops without decrementing a turn budget.
* **Queue retries**: agent tasks run on the `agent-tasks` queue (3 attempts, exponential backoff) only for retryable
  provider failures; after the last attempt the task is persisted as `FAILED` (with tokens already spent) and is
  retried by a person (`retryTask`) — agent tasks are deliberately not sent to the dead-letter queue, because the
  task row itself is the durable record. AI Command steps retry a failed task once automatically (`AUTO_RETRIES`).
* **Park on approval** (`WAITING_APPROVAL`, G1 B27): a task created with `parkOnApproval` (every AI Command step)
  stops after a turn whose tool calls filed approval requests; its conversation is stored in
  `agent_tasks.resume_state`. When every request is decided (executed, failed, rejected or expired), the
  `approval.resolved` handler (`approvals/jobs.ts`) or the 60 s sweep re-queues it, and the run continues with the
  outcomes. At most `MAX_PARKS` (3) parks per task; a task parked longer than 4 days fails with `approval_timeout`.
* **Approved actions** run once per attempt (claim `approvals.attempts`, idempotency key `approval:<id>:<attempt>`):
  inline when a person approves, on the `module-jobs` queue (`approvals.execute`) when a FAILED action is retried
  from a worker-enabled process, else inline. Executions lost mid-way become FAILED after 15 minutes. At most 3
  attempts. Every outcome is emitted as `approval.resolved`, written back to the requesting task's trace and audited on
  the AI Command run (`guide.command.approval_outcome`).
* **Tool results are verified** before the model or an approval sees them (`tools/gateway.ts verifyToolOutput`, step 11
  of docs/tool-system.md): the generic ToolOutput contract, then the tool's own `output` schema when it declares one;
  results are cut at 100,000 characters.
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

As implemented (G1, B13) in `packages/backend/src/server/modules/agents/providers/`:

```ts
interface ModelProvider {
  key: "anthropic" | "openai" | "gemini";
  configured(): boolean;                                        // its platform key is set
  call(req: ModelRequest, opts?: CallOptions): Promise<ModelResponse>;
}
```
* The runtime speaks one canonical format — the Anthropic Messages shape (system blocks, tool_use / tool_result,
  usage). `openai.ts` (Chat Completions + function calling) and `gemini.ts` (generateContent + function declarations,
  JSON-schema subset) translate requests and replies; prompt-cache hits are reported as cache reads. Keys are Realy's
  platform keys only: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (Admin → Platform keys).
* **Model routing** by tier (`agents/router.ts`): simple / standard / complex mapped through the admin routing table
  (Admin → AI → Models → Tier routing; per profile class or platform-wide), pinned models first.
* **Fallback**: the admin fallback chain, the next tier, then the same tier on every other provider with a key
  (`AiProviderInfo.fallbackModels`). Providers without a key are skipped; a provider that rejects its credentials is
  skipped for the rest of the call; model/availability errors trip that model's circuit breaker.
* **Cost**: list prices for Anthropic, OpenAI and Gemini models in `workforce/pricing.ts` (admin overrides in
  `costs/prices.ts`); every turn is written to the cost ledger with its provider and model and counted against
  cost budgets.
* `aiConfigured()` is true when any provider is configured; without one, tasks are refused, never simulated.

## 5. Observability
OpenTelemetry span per run and per step (`agent.run`, `agent.step`, `model.generate`, `tool.call`)
with attributes: org, company, agent, tokens, cost, latency, outcome. Metrics: success rate,
escalation rate, cost per task, tool failure rate, approval latency.
