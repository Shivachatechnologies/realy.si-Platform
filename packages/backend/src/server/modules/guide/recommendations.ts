import type { MetricKey } from "./pages";
import type { Counts, OnboardingState } from "./state";

/**
 * Company-wide recommended actions, ranked by urgency and derived only from real counts. Text: guide.recs.<key>.title
 * (with {count}) and guide.recs.<key>.why.
 */
interface RecRule {
  key: string;
  metric: MetricKey;
  /** Fires when the count is > 0 ("attention") or === 0 ("setup"). */
  when: "positive" | "zero";
  priority: number;
  href: string;
  module: string;
}

const RULES: RecRule[] = [
  { key: "approvals", metric: "approvalsPending", when: "positive", priority: 100, href: "/approvals", module: "core" },
  { key: "overdueInvoices", metric: "overdueInvoices", when: "positive", priority: 92, href: "/finance/invoices", module: "finance" },
  { key: "openTickets", metric: "openTickets", when: "positive", priority: 88, href: "/support", module: "support" },
  { key: "brain", metric: "brainDocs", when: "zero", priority: 80, href: "/brain", module: "knowledge" },
  { key: "objective", metric: "objectives", when: "zero", priority: 76, href: "/objectives", module: "core" },
  { key: "pendingLeave", metric: "pendingLeave", when: "positive", priority: 72, href: "/hr/leave", module: "hr" },
  { key: "hire", metric: "aiEmployees", when: "zero", priority: 66, href: "/workforce/hire", module: "ai" },
  { key: "lead", metric: "leads", when: "zero", priority: 60, href: "/crm", module: "sales" },
  { key: "project", metric: "projects", when: "zero", priority: 52, href: "/projects", module: "projects" },
  { key: "team", metric: "employees", when: "zero", priority: 46, href: "/hr/employees", module: "hr" },
  { key: "invoice", metric: "invoices", when: "zero", priority: 42, href: "/finance/invoices/new", module: "finance" },
  { key: "campaign", metric: "campaigns", when: "zero", priority: 38, href: "/marketing/campaigns", module: "marketing" },
  { key: "connect", metric: "connections", when: "zero", priority: 34, href: "/integrations", module: "platform" },
  { key: "automate", metric: "workflows", when: "zero", priority: 30, href: "/workflows/templates", module: "automation" },
];

export const REC_METRICS: MetricKey[] = [...new Set(RULES.map((r) => r.metric))];

export interface Recommendation {
  key: string;
  href: string;
  module: string;
  count: number | null;
  priority: number;
}

/** Ranked recommendations; an unfinished builder run (or a brand-new company when the builder exists) comes first. */
export function recommend(counts: Counts, onboarding: OnboardingState, limit = 3): Recommendation[] {
  const out: Recommendation[] = [];
  if (onboarding.unfinishedRun) out.push({ key: "builderResume", href: "/builder", module: "ai", count: null, priority: 1000 });
  else if (onboarding.builderAvailable) {
    const known = REC_METRICS.map((m) => counts[m]).filter((v): v is number => typeof v === "number");
    if (known.length > 0 && known.every((v) => v === 0)) out.push({ key: "builderStart", href: "/builder", module: "ai", count: null, priority: 999 });
  }
  for (const r of RULES) {
    const n = counts[r.metric];
    if (typeof n !== "number") continue;
    if ((r.when === "positive" && n > 0) || (r.when === "zero" && n === 0)) out.push({ key: r.key, href: r.href, module: r.module, count: n, priority: r.priority });
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, limit);
}
