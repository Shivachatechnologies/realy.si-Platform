import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiBudgetsOverview, budgetRuleInput, updateBudgetRule } from "@/server/modules/admin/ai-budgets";

/** Budgets center (GET) and create / change / remove one platform AI budget (PUT, audited). */
export const GET = route({ auth: "required", name: "GET /admin/ai/budgets" }, async ({ ctx }) => aiBudgetsOverview(ctx));

export const PUT = route({ auth: "required", name: "PUT /admin/ai/budgets", rateLimits: LIMITS.admin }, async ({ req, ctx }) => updateBudgetRule(ctx, await body(req, budgetRuleInput)));
