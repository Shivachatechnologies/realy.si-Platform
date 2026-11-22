import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiProviderDetail, resetBreakersInput, resetProviderBreakersAdmin } from "@/server/modules/admin/ai-requests";

type P = { key: string };

/** Provider detail: health, models, pricing, fallback priority, usage and errors. */
export const GET = route<P>({ auth: "required", name: "GET /admin/ai/providers/:key" }, async ({ ctx }, { key }) => aiProviderDetail(ctx, key));

/** Reset the provider's circuit breakers (platform.ai.manage, reason, audited). */
export const POST = route<P>({ auth: "required", name: "POST /admin/ai/providers/:key", rateLimits: LIMITS.admin }, async ({ req, ctx }, { key }) => resetProviderBreakersAdmin(ctx, key, await body(req, resetBreakersInput)));
