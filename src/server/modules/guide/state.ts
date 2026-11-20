import "server-only";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import type { MetricKey } from "./pages";

type Scope = { organizationId: string; companyId: string };
type Counter = { permission: string; count: (s: Scope) => Promise<number> };

/**
 * Cheap company-scoped counts the guide reasons from ("You have 0 leads → add your first lead"). Each sits behind the
 * owning module's read permission: without it the count is unknown (null), never leaked.
 */
const COUNTERS: Record<MetricKey, Counter> = {
  leads: { permission: "sales.read", count: (s) => db().lead.count({ where: { ...s, archivedAt: null } }) },
  deals: { permission: "sales.read", count: (s) => db().crmDeal.count({ where: { ...s, archivedAt: null } }) },
  openDeals: { permission: "sales.read", count: (s) => db().crmDeal.count({ where: { ...s, archivedAt: null, status: "OPEN" } }) },
  contacts: { permission: "sales.read", count: (s) => db().contact.count({ where: { ...s, archivedAt: null } }) },
  customers: { permission: "sales.read", count: (s) => db().account.count({ where: { ...s, archivedAt: null, type: "CUSTOMER" } }) },
  salesTargets: { permission: "sales.read", count: (s) => db().crmSalesTarget.count({ where: s }) },
  proposals: { permission: "sales.read", count: (s) => db().crmProposal.count({ where: { ...s, archivedAt: null } }) },
  invoices: { permission: "finance.read", count: (s) => db().invoice.count({ where: s }) },
  overdueInvoices: { permission: "finance.read", count: (s) => db().invoice.count({ where: { ...s, status: "OVERDUE" } }) },
  expenses: { permission: "finance.read", count: (s) => db().financeTransaction.count({ where: { ...s, type: "EXPENSE" } }) },
  bills: { permission: "finance.read", count: (s) => db().financeBill.count({ where: s }) },
  employees: { permission: "hr.read", count: (s) => db().employee.count({ where: { ...s, archivedAt: null, status: { not: "TERMINATED" } } }) },
  departments: { permission: "hr.read", count: (s) => db().department.count({ where: { ...s, archivedAt: null } }) },
  openJobs: { permission: "hr.read", count: (s) => db().hrJob.count({ where: { ...s, status: "OPEN" } }) },
  candidates: { permission: "hr.read", count: (s) => db().hrCandidate.count({ where: { ...s, archivedAt: null } }) },
  policies: { permission: "hr.read", count: (s) => db().hrPolicy.count({ where: { ...s, archivedAt: null } }) },
  pendingLeave: { permission: "hr.read", count: (s) => db().hrLeaveRequest.count({ where: { ...s, status: "PENDING" } }) },
  projects: { permission: "projects.read", count: (s) => db().project.count({ where: { ...s, archivedAt: null } }) },
  openTasks: { permission: "projects.read", count: (s) => db().workTask.count({ where: { ...s, archivedAt: null, status: { notIn: ["DONE", "CANCELLED"] } } }) },
  productFeatures: { permission: "projects.read", count: (s) => db().productFeature.count({ where: { ...s, archivedAt: null } }) },
  productIdeas: { permission: "projects.read", count: (s) => db().productIdea.count({ where: s }) },
  products: { permission: "graph.read", count: (s) => db().graphEntity.count({ where: { ...s, kind: "PRODUCT" } }) },
  opsProcesses: { permission: "operations.read", count: (s) => db().opsProcess.count({ where: { ...s, archivedAt: null } }) },
  campaigns: { permission: "marketing.read", count: (s) => db().marketingCampaign.count({ where: { ...s, archivedAt: null } }) },
  content: { permission: "marketing.read", count: (s) => db().marketingContent.count({ where: { ...s, archivedAt: null } }) },
  brandKit: { permission: "marketing.read", count: (s) => db().marketingBrandKit.count({ where: s }) },
  openTickets: { permission: "support.read", count: (s) => db().supportTicket.count({ where: { ...s, status: { in: ["NEW", "OPEN", "PENDING"] } } }) },
  kbArticles: { permission: "support.read", count: (s) => db().supportKbArticle.count({ where: s }) },
  workflows: { permission: "workflows.read", count: (s) => db().workflow.count({ where: { ...s, status: { not: "ARCHIVED" } } }) },
  activeWorkflows: { permission: "workflows.read", count: (s) => db().workflow.count({ where: { ...s, status: "ACTIVE" } }) },
  aiEmployees: { permission: "agents.read", count: (s) => db().aiEmployee.count({ where: { ...s, archivedAt: null } }) },
  agentTasks: { permission: "agents.read", count: (s) => db().agentTask.count({ where: s }) },
  brainDocs: { permission: "brain.read", count: (s) => db().brainDocument.count({ where: { ...s, status: { not: "FAILED" } } }) },
  graphEntities: { permission: "graph.read", count: (s) => db().graphEntity.count({ where: s }) },
  objectives: { permission: "objectives.read", count: (s) => db().objective.count({ where: { ...s, status: "ACTIVE" } }) },
  companyGoals: { permission: "objectives.read", count: (s) => db().companyGoal.count({ where: { ...s, status: "ACTIVE" } }) },
  milestones: { permission: "objectives.read", count: (s) => db().milestone.count({ where: s }) },
  strategy: { permission: "companies.read", count: (s) => db().companyStrategy.count({ where: s }) },
  approvalsPending: { permission: "approvals.read", count: (s) => db().approval.count({ where: { ...s, status: "PENDING" } }) },
  connections: { permission: "integrations.read", count: (s) => db().integrationConnection.count({ where: { ...s, status: "CONNECTED" } }) },
  announcements: { permission: "communication.read", count: (s) => db().commsAnnouncement.count({ where: s }) },
  channels: { permission: "communication.read", count: (s) => db().commsChannel.count({ where: { ...s, archivedAt: null } }) },
  meetings: { permission: "communication.read", count: (s) => db().commsMeeting.count({ where: s }) },
  dashboards: { permission: "analytics.read", count: (s) => db().biDashboard.count({ where: s }) },
  reports: { permission: "analytics.read", count: (s) => db().biReport.count({ where: s }) },
  installs: { permission: "marketplace.read", count: (s) => db().marketplaceInstallation.count({ where: s }) },
  members: { permission: "users.read", count: (s) => db().membership.count({ where: { organizationId: s.organizationId, status: "ACTIVE" } }) },
};

export type Counts = Partial<Record<MetricKey, number | null>>;

/** Count the given metrics in parallel. A metric the viewer may not read, or whose table is unavailable, is null. */
export async function countMetrics(ctx: RequestContext, scope: Scope, chain: ScopeChain, keys: readonly MetricKey[]): Promise<Counts> {
  const unique = [...new Set(keys)];
  const allowed = new Map<string, Promise<boolean>>();
  const permitted = (p: string) => {
    let v = allowed.get(p);
    if (!v) allowed.set(p, (v = can(ctx, p, chain).catch(() => false)));
    return v;
  };
  const values = await Promise.all(
    unique.map(async (k) => {
      const c = COUNTERS[k];
      if (!(await permitted(c.permission))) return null;
      return c.count(scope).catch(() => null);
    }),
  );
  return Object.fromEntries(unique.map((k, i) => [k, values[i]!])) as Counts;
}

/** Finished states of a builder run; any other state is an unfinished run the guide should resume first. */
const BUILDER_DONE = new Set(["COMPLETED", "COMPLETE", "DONE", "APPLIED", "SUCCEEDED", "CANCELLED", "CANCELED", "ARCHIVED", "FAILED", "DISCARDED"]);

export interface OnboardingState {
  /** The AI company builder is installed (its table exists). */
  builderAvailable: boolean;
  /** Latest builder run is not finished. */
  unfinishedRun: { id: string; status: string } | null;
}

/**
 * Onboarding awareness: whether the AI company builder exists in this deployment (table `builder_runs`) and the
 * company has an unfinished run. Probed with to_regclass so a deployment without the builder simply reports none.
 */
export async function onboardingState(scope: Scope): Promise<OnboardingState> {
  try {
    const reg = await db().$queryRaw<{ t: string | null }[]>`SELECT to_regclass('public.builder_runs')::text AS t`;
    if (!reg[0]?.t) return { builderAvailable: false, unfinishedRun: null };
    const rows = await db().$queryRaw<{ id: string; status: string }[]>`
      SELECT id::text AS id, status::text AS status FROM builder_runs
      WHERE organization_id = ${scope.organizationId}::uuid AND company_id = ${scope.companyId}::uuid
      ORDER BY created_at DESC LIMIT 1`;
    const run = rows[0];
    return { builderAvailable: true, unfinishedRun: run && !BUILDER_DONE.has(run.status.toUpperCase()) ? run : null };
  } catch {
    return { builderAvailable: false, unfinishedRun: null };
  }
}
