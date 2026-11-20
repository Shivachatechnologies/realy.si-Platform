import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteExpense } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; expenseId: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/expenses/:expenseId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, expenseId }) => deleteExpense(ctx, orgId, companyId, expenseId));
