import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { employeeMemoryAdmin, employeeMemoryInput } from "@/server/modules/admin/ai-ops";

/** Delete one memory note or purge all of an AI employee's memory (typed PURGE), audited. */
export const POST = route<{ employeeId: string }>({ auth: "required", name: "POST /admin/ai/employees/:id/memory", rateLimits: LIMITS.admin }, async ({ req, ctx }, { employeeId }) =>
  employeeMemoryAdmin(ctx, employeeId, await body(req, employeeMemoryInput)),
);
