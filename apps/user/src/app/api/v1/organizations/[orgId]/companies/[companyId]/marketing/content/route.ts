import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { contentInput, createContent, listContent, parseContentFilters } from "@/server/modules/marketing/content";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listContent(ctx, orgId, companyId, parseContentFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/content", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createContent(ctx, orgId, companyId, await body(req, contentInput)));
