import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { employeeLifecycle, employeeLifecycleInput } from "@/server/modules/admin/ai-ops";

/** Disable (archive, typed name) or re-enable an AI employee (platform.ai.manage, reason, audited). */
export const POST = route<{ employeeId: string }>({ auth: "required", name: "POST /admin/ai/employees/:id/lifecycle", rateLimits: LIMITS.admin }, async ({ req, ctx }, { employeeId }) =>
  employeeLifecycle(ctx, employeeId, await body(req, employeeLifecycleInput)),
);
