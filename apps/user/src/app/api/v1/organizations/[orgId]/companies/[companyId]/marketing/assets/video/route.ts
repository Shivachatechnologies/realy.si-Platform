import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { startVideo, videoInput } from "@/server/modules/marketing/assets";

type P = { orgId: string; companyId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/assets/video", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => startVideo(ctx, orgId, companyId, await body(req, videoInput)));
