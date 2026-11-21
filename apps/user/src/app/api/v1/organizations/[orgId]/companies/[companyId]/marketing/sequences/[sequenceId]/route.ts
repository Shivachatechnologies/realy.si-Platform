import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveSequence, getSequence, updateSequence, updateSequenceInput } from "@/server/modules/marketing/sequences";

type P = { orgId: string; companyId: string; sequenceId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, sequenceId }) => getSequence(ctx, orgId, companyId, sequenceId, req.nextUrl.searchParams.get("status") ?? undefined));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/sequences/:sequenceId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, sequenceId }) => updateSequence(ctx, orgId, companyId, sequenceId, await body(req, updateSequenceInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/sequences/:sequenceId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, sequenceId }) => archiveSequence(ctx, orgId, companyId, sequenceId));
