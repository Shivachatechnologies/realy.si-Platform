import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createGuideRequest, guideRequestInput, listGuideRequests } from "@/server/modules/guide/service";

type P = { orgId: string; companyId: string };

/** GET ?pageKey= — the viewer's recent guide requests. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({
  data: await listGuideRequests(ctx, orgId, companyId, req.nextUrl.searchParams.get("pageKey") ?? undefined),
}));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/guide/requests", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createGuideRequest(ctx, orgId, companyId, await body(req, guideRequestInput)),
);
