import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteCostBudget } from "@/server/modules/costs/service";

type P = { orgId: string; companyId: string; budgetId: string };

/** Remove a spending budget. */
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/costs/budgets/:budgetId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, budgetId }) => deleteCostBudget(ctx, orgId, companyId, budgetId),
);
