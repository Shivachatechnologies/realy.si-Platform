import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createFlag, createFlagInput, listFlags } from "@/server/modules/flags/service";

export const GET = route({ auth: "required" }, async ({ ctx }) => ({ data: await listFlags(ctx) }));

/** Create a feature flag (flags.manage). */
export const POST = route({ auth: "required", name: "POST /admin/feature-flags", rateLimits: LIMITS.admin }, async ({ req, ctx }) => createFlag(ctx, await body(req, createFlagInput)));
