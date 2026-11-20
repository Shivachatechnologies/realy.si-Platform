# Building a business module

Every department module (CRM, marketing, finance, HR, work, communication, support, automation, integrations, AI workforce,
analytics, marketplace, enterprise) follows the same shape so modules stay isolated, secure and connected.

## Layout

| Concern | Location |
|---|---|
| Database models | `prisma/schema/<module>.prisma` (multi-file schema; core models live in `prisma/schema/core.prisma`) |
| Services (business logic) | `src/server/modules/<module>/*.ts` |
| API routes | `src/app/api/v1/organizations/[orgId]/companies/[companyId]/<module>/...` |
| Pages | `src/app/[locale]/(app)/<route>/...` |
| Client components | `src/components/<module>/*.tsx` |
| AI tools | `src/server/modules/<module>/ai-tools.ts` (registered in `tools/modules.ts`) |
| AI employee profiles | `src/server/modules/<module>/ai-profiles.ts` (data only; registered in `agents/module-profiles.ts`) |
| Background jobs / event consumers | `src/server/modules/<module>/jobs.ts` (run by the worker via `src/worker/modules.ts`) |
| Strings | every locale in `src/i18n/messages/*.json`, under the module's own namespace |

## Rules

- **Tenant isolation.** Every tenant row has `organizationId` and `companyId`, and a relation
  `company Company @relation(fields: [companyId, organizationId], references: [id, organizationId], onDelete: Cascade)`.
  Child rows reference parents with composite keys `(parentId, companyId)` → `@@unique([id, companyId])` on the parent.
  Every query filters by `organizationId` and `companyId`; ids from the client are validated as UUIDs and looked up
  inside the company before use.
- **Authorization.** Services call `requirePermission(ctx, "<area>.<action>", await companyChain(db, org, company))`
  first (inside the transaction for writes). Pages use `can()` only to hide controls. Permissions are defined in
  `src/server/modules/rbac/catalog.ts`.
- **Writes** run in `transaction()`, write an audit row (`writeAudit`) and, for business events, a domain event with
  `emitDomainEvent(tx, ctx, "<type>", { organizationId, companyId, entityType, entityId, data })` (types are listed in
  `events/catalog.ts` → `DOMAIN_EVENTS`). The automation engine and AI triggers consume these events.
- **Notifications:** `notifyUsers(tx, organizationId, userIds, "<module>.<kind>", { title, href, companyId })` and
  add `notifications.kinds.<module>.<kind>` (with `{title}`) in every locale. `usersWithPermission()` finds recipients.
- **API routes** use `route()` from `@/server/core/http` with `rateLimits: LIMITS.tenantWrite` and `idempotent: true`
  for POST, `body(req, schema)` for input. Lists return `{ data }` (or a `Page`).
- **Money** is integer minor units (`BigInt`) plus a 3-letter currency; format with `formatMoney`. Dates through
  `formatDate`/`formatDateTime` with the company timezone.
- **AI.** Agents act only through tools (`def` from `tools/define.ts`): reads are `AUTONOMOUS` + `LOW`; anything that
  changes data is `SUPERVISED` (approval) and anything external (sending, publishing, paying) is `SUPERVISED` +
  `HIGH`. Never report an external action as done unless the provider accepted it. To attach AI work to a record, call
  `createTask(ctx, org, company, { profile, title, instructions, subject: { type, id } })` and show
  `listSubjectTasks(...)` on the record's page.
- **External providers** read credentials from the Integrations module (encrypted at rest). When a provider is not
  connected, the feature shows "not connected" with a link to set it up and records nothing as sent.
- **UI.** Server components load data; small client components (`"use client"`) do mutations via `api()` and
  `router.refresh()`. Reuse `src/components/ui/*`. Every page handles: no company, forbidden, empty, error
  (`FormError`), and success. Logical CSS properties (`ms-`, `pe-`, `start`/`end`) keep RTL correct.
