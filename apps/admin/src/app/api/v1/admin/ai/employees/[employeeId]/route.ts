import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { employeeAdminInput, getEmployeeAdmin, updateEmployeeAdmin } from "@/server/modules/admin/ai-ops";

type P = { employeeId: string };

export const GET = route<P>({ auth: "required", name: "GET /admin/ai/employees/:id" }, async ({ ctx }, { employeeId }) => getEmployeeAdmin(ctx, employeeId));

/** Model, tools, budgets, autonomy and pause/resume of one AI employee (workforce service), audited. */
export const PUT = route<P>({ auth: "required", name: "PUT /admin/ai/employees/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { employeeId }) =>
  updateEmployeeAdmin(ctx, employeeId, await body(req, employeeAdminInput)),
);
