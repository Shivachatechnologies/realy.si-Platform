import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { MAX_RESUME_BYTES, candidateInput, createCandidate, listCandidates, parseCandidateFilters } from "@/server/modules/hr/recruiting";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await listCandidates(ctx, orgId, companyId, parseCandidateFilters(Object.fromEntries(req.nextUrl.searchParams))) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/candidates", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: Math.ceil((MAX_RESUME_BYTES * 4) / 3) + 64 * 1024 }, async ({ req, ctx }, { orgId, companyId }) => createCandidate(ctx, orgId, companyId, await body(req, candidateInput)));
