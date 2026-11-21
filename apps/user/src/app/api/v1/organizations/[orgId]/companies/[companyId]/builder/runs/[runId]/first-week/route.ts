import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { firstWeekTasks, kickoffFirstWeek } from "@/server/modules/builder/first-week";

type P = { orgId: string; companyId: string; runId: string };

/** GET — the run's first-week agent tasks (AI CEO plan + department deliverables). */
export const GET = route<P>(
  { auth: "required" },
  async ({ ctx }, { orgId, companyId, runId }) => ({ data: await firstWeekTasks(ctx, orgId, companyId, runId) }),
);

/** POST — start (or retry) the first week: creates only the deliverables that are missing. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/first-week", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, runId }) => kickoffFirstWeek(ctx, orgId, companyId, runId),
);
