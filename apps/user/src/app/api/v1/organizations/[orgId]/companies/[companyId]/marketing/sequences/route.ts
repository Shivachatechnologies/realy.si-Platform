import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createSequence, listSequences, sequenceInput } from "@/server/modules/marketing/sequences";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listSequences(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/sequences", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createSequence(ctx, orgId, companyId, await body(req, sequenceInput)));
