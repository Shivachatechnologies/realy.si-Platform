import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveContent, getContent, updateContent, updateContentInput } from "@/server/modules/marketing/content";

type P = { orgId: string; companyId: string; contentId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, contentId }) => getContent(ctx, orgId, companyId, contentId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/content/:contentId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, contentId }) => updateContent(ctx, orgId, companyId, contentId, await body(req, updateContentInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/content/:contentId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, contentId }) => archiveContent(ctx, orgId, companyId, contentId));
