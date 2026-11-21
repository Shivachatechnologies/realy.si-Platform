import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { lifecycleInput, runLifecycleAction } from "@/server/modules/workforce/lifecycle";

type P = { orgId: string; companyId: string; employeeId: string };

/** Lifecycle actions (assign, promote, change role / manager / permissions, pause, resume, evaluate, replace, retire). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/employees/:id/lifecycle", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, employeeId }) => runLifecycleAction(ctx, orgId, companyId, employeeId, await body(req, lifecycleInput)),
);
