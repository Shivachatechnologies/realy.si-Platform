import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createSegment, listSegments, segmentInput } from "@/server/modules/marketing/segments";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listSegments(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/segments", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createSegment(ctx, orgId, companyId, await body(req, segmentInput)));
