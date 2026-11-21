import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { costBudgetInput, setCostBudget } from "@/server/modules/costs/service";

type P = { orgId: string; companyId: string };

/** Create or update a spending budget (company / department / AI employee monthly, or per task). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/costs/budgets", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => setCostBudget(ctx, orgId, companyId, await body(req, costBudgetInput)),
);
