import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listControls, setControl, setControlInput } from "@/server/modules/admin/controls";

export const GET = route({ auth: "required", name: "GET /admin/controls" }, async ({ ctx }) => listControls(ctx));

export const PUT = route({ auth: "required", name: "PUT /admin/controls", rateLimits: LIMITS.admin }, async ({ req, ctx }) => setControl(ctx, await body(req, setControlInput)));
