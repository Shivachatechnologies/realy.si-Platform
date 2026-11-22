import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminTenantBudget, tenantBudgetInput } from "@/server/modules/admin/ai-budgets";

/** Platform override of one tenant cost budget: limit / hard stop, or remove (reason, audited). */
export const PUT = route<{ budgetId: string }>({ auth: "required", name: "PUT /admin/ai/budgets/tenant/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { budgetId }) =>
  adminTenantBudget(ctx, budgetId, await body(req, tenantBudgetInput)),
);
