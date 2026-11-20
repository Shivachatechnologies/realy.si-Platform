# AI Guide, AI Command and guide UI components

The AI Guide is mounted once by the app layout (`<GuideMount>` in `src/app/[locale]/(app)/layout.tsx`): a floating
launcher (bottom-end, `Shift+?`) opens a side panel that knows the current page from the URL. `⌘J` / `Ctrl+J` (or the
panel's "expand" button) opens the full AI Command workspace at `/command`. Pages need no code to get a guide.

## Page context registry

`src/server/modules/guide/pages.ts` maps routes (`pattern`, `[param]` = a UUID segment) to: module identity, the AI
profile that answers/acts there, the read tools named to the AI, the metrics it shows, guided steps and next pages.
Unknown sub-routes inherit their closest parent's entry. Text lives in i18n under `guide.pages.<key>.{title,what,why,can,steps.<step>}`.

To add or refine a page: add an entry (steps may have `href`, a `selector` for "Show me", `done: { metric, min|max }`
to auto-complete from real counts, and `ai: { questions }` to make the step doable by "Do it for me"), then add its
strings in all five locales. Metrics are implemented in `state.ts` (each behind the owning module's read permission).

## Components for module pages

```tsx
import { SmartEmptyState } from "@/components/guide/smart-empty-state"; // client
import { PageIntro } from "@/components/guide/page-intro";               // client, plain props (usable from RSC)
import { WhatsNext } from "@/components/guide/whats-next";               // async Server Component

<PageIntro module="finance" what={t("finance.intro.what")} why={t("finance.intro.why")} can={t("finance.intro.can")}
  next={{ label: t("finance.intro.next"), href: `/${locale}/finance/invoices/new` }} />

<SmartEmptyState
  module="sales"                                   // accent + default icon (see components/guide/module-style.ts)
  icon={<Users />}                                 // optional
  title={t("crm.empty.title")}
  description={t("crm.empty.body")}
  primaryAction={{ label: t("crm.newLead"), href: `/${locale}/crm?new=1` }}
  // or: primaryAction={{ label, onClickApi: { path: "/leads", method: "POST", body: {...} } }}  (path relative to the company API)
  aiAction={{ label: t("crm.empty.ai"), profile: "sdr", instructions: "Propose 5 leads that fit our ideal customer…", subject: { type: "lead", id } }}
  examples={[t("crm.empty.ex1"), t("crm.empty.ex2")]}
/>

<WhatsNext limit={3} />   // Command Center: top recommendations from real counts, unfinished builder run first
```

`SmartEmptyState`'s AI action creates a real agent task (`POST …/tasks`) and shows its live status and result inline.
The active organization/company comes from the layout's `GuideScopeProvider`; pass `orgId`/`companyId` to override.

## API (under `/api/v1/organizations/:orgId/companies/:companyId/guide`)

| Route | Purpose |
|---|---|
| `GET context?path=` | Page context, real counts, steps with progress, recommendations, AI readiness, recent requests |
| `POST progress` | `{ pageKey, stepKey?, done?, current?, reset? }` — per-user step progress (mark done / undo / resume / reset) |
| `GET/POST requests`, `GET requests/:id` | Explain / guide / next / recommend / ask / do → a real agent task; detail includes trace and approvals |
| `GET whats-next` | Company-wide top recommendations |
| `GET/POST command`, `GET/DELETE command/:sessionId` | AI Command history + suggestions; run a command (intent router → one task per department, hired AI employee preferred, AI CEO fallback) |

All AI work goes through `createTask` (profile tools, budgets, approvals): nothing is ever reported as done unless the
task's tools confirmed it, and changes wait in Approvals.
