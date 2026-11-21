import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { maintenanceInput, setMaintenance } from "@/server/modules/admin/ops";

/** Maintenance mode on/off (typed confirmation "maintenanceMode" to turn it on). */
export const PUT = route({ auth: "required", name: "PUT /admin/ops/maintenance", rateLimits: LIMITS.admin }, async ({ req, ctx }) => setMaintenance(ctx, await body(req, maintenanceInput)));
