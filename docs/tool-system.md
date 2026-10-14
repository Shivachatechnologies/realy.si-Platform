# Realy — Tool System & Tool Gateway

> Status: **Protocol frozen; implementation Phase 3 (internal tools) and Phase 5 (provider tools).**

## 1. Tool definition contract

Every capability an agent can exercise is a **tool** registered in code (`src/server/modules/tools/registry`)
with a declarative definition. The registry is the only way agents act.

```ts
interface ToolDefinition<I, O> {
  name: string;                     // snake_case, globally unique: "create_github_issue"
  version: number;                  // bump on breaking schema change
  description: string;              // shown to the model
  input: z.ZodType<I>;              // validated before execution; exported as JSON Schema to the model
  output: z.ZodType<O>;             // validated after execution; invalid output = tool failure
  permissions: PermissionKey[];     // RBAC permissions required by the calling principal (e.g. "integrations.read", "sales.manage")
  resourceScope: (input: I, ctx) => ScopeChain;   // which company/workspace/project the call touches
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  autonomy: 'AUTONOMOUS' | 'SUPERVISED' | 'FOUNDER_ONLY';
  provider: ProviderId | 'internal';              // which Realy Connect adapter, if any
  requiredScopes?: string[];        // provider OAuth scopes needed
  timeoutMs: number;
  retry: { retryable: boolean; maxAttempts: number };
  idempotent: boolean;              // gateway supplies an idempotency key per call
  cost: { estimate(input: I): Money | null };      // used by budget policy
  audit: 'NONE' | 'SUMMARY' | 'FULL';              // FULL stores redacted input/output
  execute(input: I, ctx: ToolExecutionContext): Promise<O>;
}
```

## 2. Gateway pipeline

```
agent runtime ── tool.request(name, rawInput, runCtx)
  1. lookup definition (unknown tool → error, counted as model error)
  2. agent allow-list: tool ∈ agent.tools
  3. input = definition.input.parse(rawInput)               (Zod / JSON Schema)
  4. RBAC: can(agentPrincipal, p, definition.resourceScope(input)) for each p
  5. tenant check: every resource id in input belongs to the run's organization/company
  6. risk & autonomy policy: AUTONOMOUS → continue; SUPERVISED → approval unless a standing approval rule
     covers it; FOUNDER_ONLY → approval by an ORGANIZATION_OWNER with MFA, every time
  7. budget policy: estimated cost ≤ remaining task/agent/company budget
  8. rate limit: per tool, per provider connection, per company
  9. credentials: Realy Connect mints a short-lived, minimally-scoped token for the provider call
 10. execute with timeout + abort signal; circuit breaker per provider
 11. output = definition.output.parse(result)
 12. persist tool_calls row (status, latency, cost, redacted I/O per audit level) + event tool.call.completed|failed
```
Steps 2–8 never consult the model. Denials return a structured error the agent can reason about
("requires approval", "not permitted", "not connected") — and the UI shows the same limitation.

## 3. Initial tool catalog

| Tool | Provider | Autonomy | Risk |
|---|---|---|---|
| search_web | internal (search API) | AUTONOMOUS | LOW |
| read_document / create_document | internal | AUTONOMOUS | LOW |
| create_report / analyze_campaign | internal | AUTONOMOUS | LOW |
| create_lead / update_crm / create_deal | internal CRM or HubSpot/Salesforce | AUTONOMOUS (internal) / SUPERVISED (external CRM bulk) | MEDIUM |
| send_email | Gmail / Microsoft / email provider | SUPERVISED | HIGH |
| create_calendar_event | Google Calendar / Microsoft | SUPERVISED (external attendees) | MEDIUM |
| create_github_issue | GitHub | AUTONOMOUS | LOW |
| create_pull_request | GitHub | AUTONOMOUS (PR only; merge is SUPERVISED) | MEDIUM |
| run_tests | sandbox | AUTONOMOUS | LOW |
| deploy_application | Vercel / Cloudflare / AWS | SUPERVISED (preview AUTONOMOUS) | HIGH |
| create_invoice | Stripe | SUPERVISED | HIGH |
| transfer_funds / change_banking | banking providers | FOUNDER_ONLY | CRITICAL |

## 4. Browser & computer tools (Phase 5)
`browser.navigate|click|type|fill_form|upload|download|screenshot|inspect` and
`computer.exec|git|fs.read|fs.write|docker|cloud_cli`. They run only inside an isolated sandbox
session bound to one run; every action is logged with a screenshot/console capture; network egress
is allow-listed; destructive commands (e.g. production deploys, `rm -rf` outside workspace) are
classified HIGH and supervised.

## 5. Testing
Every tool ships with: schema round-trip tests, permission-denied test, approval-required test (for
non-AUTONOMOUS), provider-adapter contract test against recorded fixtures, and timeout/retry tests.
