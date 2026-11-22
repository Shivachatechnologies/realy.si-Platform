# Realy — Workflow Engine & Event Bus

> Status: **Event contract and outbox implemented in Phase 1; workflow engine Phase 3–4.**

## 1. Domain events (implemented)

Event envelope (`events` table = transactional outbox):
```ts
interface DomainEvent<T> {
  id: string;            // uuid v7
  type: string;          // "company.created"
  version: number;       // schema version of payload for this type
  organizationId: string | null;
  companyId: string | null;
  aggregateType: string; aggregateId: string;
  actor: { type: 'USER' | 'SERVICE_ACCOUNT' | 'AGENT' | 'SYSTEM'; id: string | null };
  requestId: string | null;
  occurredAt: string;
  payload: T;            // validated by the registered Zod schema for (type, version)
}
```
* Written **inside the same DB transaction** as the state change (`emitEvent(tx, …)`).
* The **outbox relay** worker polls unpublished events (`FOR UPDATE SKIP LOCKED`, batches of 500),
  publishes to BullMQ queue `events` and marks `published_at`. Delivery is at-least-once; consumers
  are idempotent by `event.id`.
* Payload schemas live in `src/server/modules/events/catalog.ts`; emitting an unregistered type or an
  invalid payload throws.

Catalog (Phase 1 implemented ✅, others reserved):
`user.registered` ✅, `organization.created` ✅, `member.invited` ✅, `member.joined`,
`company.created` ✅, `workspace.created` ✅, `role.created` ✅, `role.assigned` ✅, `role.revoked`,
`pricing.plan.created` ✅, `pricing.price.created` ✅, `pricing.price_version.created` ✅,
`feature_flag.updated` ✅, `globalization.country.updated` ✅, `customer.created`, `lead.created`,
`deal.created`, `payment.completed`, `invoice.overdue`, `campaign.started`, `deployment.completed`,
`objective.created`, `task.completed`, `approval.requested`, `approval.resolved`, `agent.failed`,
`workflow.completed`, `integration.connected`.

## 2. Workflow engine (Phase 3–4)

```
Trigger → Condition → Data → Decision → Action → Approval → Execution → Verification → Event
```
* **Definition**: versioned JSON DAG (`workflow_versions.definition`) of typed steps:
  `trigger` (schedule cron+tz | event type+filter | manual | webhook), `condition` (CEL-style
  expression over typed context — no arbitrary code), `fetch` (data query), `decide` (rule table or
  agent decision), `action` (tool call via Tool Gateway), `approval`, `parallel`/`join`, `wait`
  (duration or event), `verify`, `emit`.
* **Execution**: each step run is a durable record (`workflow_step_runs`) and a BullMQ job keyed by
  `(run_id, step_id, attempt)`. The engine is a deterministic state machine: given the run's
  persisted step results it computes the next runnable steps (dependencies satisfied), so crash
  recovery is "recompute and enqueue missing jobs".
* **Retries/timeouts** per step; **cancellation** propagates to running tool calls via abort signals;
  **compensation**: action steps may declare a compensating action executed in reverse order on
  failure (saga pattern) where the provider supports it.
* **Human approval** steps create `approvals` and park the run (no worker held).
* **Schedules** are stored in DB and materialized into BullMQ repeatable jobs with timezone-aware
  cron; the DB is the source of truth (rebuild on deploy).
* Limits: max steps per run, max parallelism per company, max run duration, per-plan quotas.

### Autonomy of external actions (B5, B22)

External actions (`send_email`, `send_slack`, `send_teams`, `http_webhook`, `custom_api`) are checked before they run
(`automation/governance.ts`):

1. **Company kill switch** ("Pause all AI"): the run is held (`WAITING`, `waitingFor: company_paused`, re-checked every
   5 minutes) and nothing is sent. It resumes by itself once the company is unpaused. Applies to every run.
2. **`workflows.autonomy_mode`** (`AutopilotMode`, default `APPROVAL_REQUIRED`), for runs the workflow starts itself
   (events, schedules, incoming webhooks):
   - `OFF`: external actions are refused (the step fails, the run goes to the dead-letter list);
   - `MANUAL`, `ASSISTED`, `APPROVAL_REQUIRED`: each external action files a workflow approval (Workflows → Approvals,
     decided by anyone with `workflows.execute`); approve → it runs once, reject → the run is cancelled;
   - `AUTONOMOUS`: the company's autonomy policy decides for department `operations`, class `send_message`, channel
     `email` / `chat` / `web` (daily limit, hours, channels, Auto mode). `auto` runs it and records an autonomous action
     (Autonomy → auto-approved log, undo/feedback); `ask` files an approval; `deny` refuses.
   A run a person started (test run, "Run now") is that person's action: only `OFF` and the kill switch apply.
3. Outbound HTTP goes through the SSRF guard (`docs/security.md` §11).

Existing workflows get `APPROVAL_REQUIRED` on migration: their external steps wait for an approval until the owner
chooses another mode in the workflow's settings.

## 3. Why build on Postgres + BullMQ (vs Temporal now)
Durable state in Postgres keeps workflow data tenant-scoped, queryable and auditable with the rest of
the company graph; BullMQ provides retries/backoff/rate-limits. The engine interface
(`startRun`, `signal`, `cancel`, `query`) is kept narrow so it can be backed by Temporal later if
workload demands it.
