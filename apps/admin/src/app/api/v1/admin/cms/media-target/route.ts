import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { mediaCompanyOptions, mediaTargetInput, setMediaTarget } from "@/server/modules/cms/media";

/** GET ?q= → companies that can hold website media; PUT { companyId, reason } chooses one. */
export const GET = route({ auth: "required", name: "GET /admin/cms/media-target" }, async ({ req, ctx }) => ({ data: await mediaCompanyOptions(ctx, req.nextUrl.searchParams.get("q") ?? "") }));

export const PUT = route({ auth: "required", name: "PUT /admin/cms/media-target", rateLimits: LIMITS.admin }, async ({ req, ctx }) => setMediaTarget(ctx, await body(req, mediaTargetInput)));
