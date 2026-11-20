import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { departmentBudgetInput, listDepartmentBudgets, setDepartmentBudget } from "@/server/modules/workforce/budgets";

type P = { orgId: string; companyId: string };

/** Department AI budgets with this month's spend. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ items: await listDepartmentBudgets(ctx, orgId, companyId) }));

/** Set (or with both limits null, remove) a department's monthly AI budget. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/budgets", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => setDepartmentBudget(ctx, orgId, companyId, await body(req, departmentBudgetInput)),
);
