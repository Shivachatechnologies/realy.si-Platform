# Autonomy ("Auto mode") and trust

Founders decide, per company → department → action class, how far the AI workforce may go on its own. One engine
decides; the tool gateway and every module that acts for an AI employee use it.

Code: `packages/backend/src/server/modules/workforce/autonomy-classes.ts` (classes, defaults, hard floors, tool
classification — pure), `autonomy-policy.ts` (engine, limits, demotion), `autonomy-service.ts` (control room, undo,
feedback). Models: `AutonomySettings`, `AutonomyPolicy`, `AutonomousAction`, `AutonomyFeedback`
(`packages/database/prisma/schema/workforce.prisma`). UI: `/[locale]/autonomy`. API:
`/api/v1/organizations/:orgId/companies/:companyId/workforce/autonomy/**`.

## Concepts

| Term | Meaning |
|---|---|
| Action class | `read`, `change_data`, `send_message`, `call`, `publish`, `spend`, `pay`, `contract`, `hr`, `delete_data` |
| Level | `OFF` (never), `SUGGEST` (recommend only, nothing filed), `ASK` (approval request), `AUTO` (act within limits) |
| Rule | `AutonomyPolicy` row for a department (or `"*"` = whole company) and a class. Resolution: department row → `"*"` row → default |
| Defaults | `read` = AUTO, everything else = ASK (exactly the behaviour before autonomy existed) |
| Auto mode | Company master switch (`AutonomySettings.autoModeEnabled`, off by default). While off, AUTO rules act as ASK |
| Pause all AI | `AutonomySettings.paused`: `createTask` refuses (`workforce_ai_paused`), the worker fails tasks (`company_ai_paused`), the gateway refuses every tool |
| Limits (AUTO only) | `dailyLimit` (count per company-timezone day), `perActionMaxMinor` / `dailyMaxMinor` / `monthlyMaxMinor` + `currency`, `hoursFrom`–`hoursTo` + `allowedDays`, `allowedChannels`. A company-wide rule counts the whole company; a department rule counts that department |

### Hard floors (never AUTO, whatever a rule says)

- `contract`, `hr`, `delete_data` (setting AUTO is refused; evaluation returns `ask` / `hard_floor`).
- `pay` above `PAYMENT_HARD_CAP_MAJOR` (500 major units of the currency) per action; `spend`/`pay` need a known amount
  and a per-action cap.
- FOUNDER_ONLY tools; platform kill switches (`aiWorkforceEnabled`, `aiExecutionPaused`, read-only/maintenance,
  lockdown, org `aiDisabled`, suspended org → `deny`; `aiAutonomyCeiling` supervised / `aiRequireApprovalForWrites` → `ask`).
- Turning an external class to AUTO, or Auto mode on, needs a fresh MFA verification.

## One autonomy model (precedence)

Three stored settings exist; `/autonomy` shows them as one level per department (`workforce/autonomy-unified.ts`):
**Manual** (AI works only when a person asks, suggestions only), **Assisted** (drafts and recommends; nothing filed or
done on its own), **Approval** (acts, every change waits for approval), **Autonomous** (acts on its own within the
limits of AUTO rules). The most restrictive setting wins, checked in this order:

1. Platform controls and "Pause all AI" (`AutonomySettings.paused`) → nothing runs.
2. The department's Autopilot mode (`AutopilotSetting`: OFF → paused, MANUAL, ASSISTED, APPROVAL_REQUIRED,
   AUTONOMOUS) → whether the AI may start work on its own and the ceiling for actions.
3. The autonomy rules per action class (`AutonomyPolicy`) and the Auto mode switch → whether an action runs within
   limits (AUTO, only while Auto mode is on), waits for approval (ASK), is only suggested (SUGGEST) or is off (OFF).
4. Each AI employee's autonomy level (`AiEmployee.autonomy`: READ_ONLY → Manual, RECOMMEND / PREPARE → Assisted,
   EXECUTE_WITH_APPROVAL → Approval, AUTONOMOUS_LOW_RISK → Autonomous) → which tools it is offered at all.

## Tools: nothing to do unless you want precision

The gateway (`tools/gateway.ts` `requestTool`) evaluates the policy for **AI task runs** (the runtime passes
`autonomy: { department, aiEmployeeId }`). Calls without it — e.g. a "request approval" button in your module —
keep the plain approval flow. For a SUPERVISED tool:

- `deny` → `ToolDenied` (`not_allowed`, or `suggest_only` for SUGGEST: the model is told to recommend it in its deliverable).
- `ask` → approval request as before (the audit row carries `autonomyReason` / `policyId`).
- `auto` → limits are reserved atomically (`RUNNING` row under an advisory lock), the tool executes, the row becomes
  `EXECUTED`/`FAILED`, audit rows `autonomy.auto_approved` + `autonomy.action_executed|failed` are written, and the
  tool result returns `status: "executed"` with `autonomousActionId`.

The class and channel are inferred from the tool's name, permissions and risk (`classifyTool`, conservative: unclear
→ `change_data`, drafts are never external). Declare them for precision, plus money and undo, in your `def({...})`:

```ts
def({
  name: "send_sms",
  // …existing fields…
  actionClass: "send_message",
  channel: "sms",
  amount: (input) => null, // spend/pay tools: { amountMinor: bigint, currency }; without it they always ask
  reverse: (input, output) => null, // reversible tools: { tool: "cancel_sms", input: { id } } — runs as the person clicking Undo
});
```

An AI employee's own autonomy level (`AiEmployee.autonomy`, `workforce/autonomy.ts` `toolsForAutonomy`) still narrows
which tools it is offered at all (e.g. PREPARE never gets HIGH-risk tools); the company policy then decides whether an
offered SUPERVISED tool asks or runs.

## Non-tool actions (modules acting for an AI employee)

```ts
import { evaluateAutonomy, recordAutonomousAction, runAutonomously } from "@/server/modules/workforce/autonomy-policy";

// Preferred: evaluate + reserve limits + perform + record, atomically.
const r = await runAutonomously(ctx, organizationId, companyId,
  { department: "sales", actionClass: "send_message", channel: "email" },
  { summary: `Follow-up email to ${lead.name}`, aiEmployeeId, taskId, source: "crm" },
  async () => ({ value: await send(), records: [`crm_lead:${lead.id}`], undo: null }),
);
if (!r.actionId) {
  // r.decision.decision === "ask"  → file an approval / queue for a person
  // r.decision.decision === "deny" → r.decision.reason: "policy_off" | "policy_suggest" | "company_paused" | …
}

// Or in two steps (not atomic: limits can be overshot by concurrent calls).
const d = await evaluateAutonomy(ctx, organizationId, companyId, { department, actionClass: "spend", amountMinor: 2500n, currency: "EUR" });
// → { decision: "auto" | "ask" | "deny", reason, policyId, level, rule, message }
if (d.decision === "auto") { await doIt(); await recordAutonomousAction(ctx, organizationId, companyId, { department, actionClass: "spend", amountMinor: 2500n, currency: "EUR", summary, decision: d }); }
```

`isCompanyAiPaused(organizationId, companyId)` answers "Pause all AI" for loops and schedulers.

## Trust system

- Record per department × class over 30 days (`trustRecords`): approvals of AI tasks (approved / rejected / failed),
  autonomous runs (done / failed / undone) and feedback (`EDITED`, `COMPLAINT`, `REVERSAL`), with a per-AI-employee breakdown.
- **Promotion** (`recommendationsFrom`): a class at ASK with ≥ 20 approvals, no rejections, failures, undos or
  complaints and ≤ 10 % edits is recommended for AUTO with a daily cap (2 × the busiest day, rounded to 5). Never for
  hard floors or money classes. One click applies it (recomputed server-side).
- **Demotion** (`checkDemotion`): after a rejection, failure, undo, complaint or reversal, if the governing rule is
  AUTO and negatives in the window reach the threshold (default 3 in 7 days, per company), the rule goes back to ASK,
  `autonomy.policy_demoted` is audited and everyone with `agents.manage` gets a `workforce.autonomyDemoted` notification.
- Modules report signals with `recordAutonomyFeedback(ctx, org, company, { department, actionClass, kind, note, aiEmployeeId, source })`
  (`autonomy-service.ts`) — e.g. support records a `COMPLAINT` about an AI email; a module records `EDITED` when a
  person changed an AI draft before it went out.
