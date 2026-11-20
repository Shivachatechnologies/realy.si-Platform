import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveSegment, getSegment, updateSegment, updateSegmentInput } from "@/server/modules/marketing/segments";

type P = { orgId: string; companyId: string; segmentId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, segmentId }) => getSegment(ctx, orgId, companyId, segmentId, req.nextUrl.searchParams.get("q")?.slice(0, 200) || undefined));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/segments/:segmentId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, segmentId }) => updateSegment(ctx, orgId, companyId, segmentId, await body(req, updateSegmentInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/segments/:segmentId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, segmentId }) => archiveSegment(ctx, orgId, companyId, segmentId));
