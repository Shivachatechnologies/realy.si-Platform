import { body, route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { deletePage, getPage, savePage, savePageInput } from "@/server/modules/sites/service";
import { db } from "@/server/core/db";
import { refreshSite } from "@/components/sites/cache";

type P = { orgId: string; companyId: string; pageId: string };

export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/companies/:companyId/sites/pages/:pageId" }, async ({ ctx }, { orgId, companyId, pageId }) => getPage(ctx, orgId, companyId, pageId));

/** Save the draft and page settings (address, kind, navigation). */
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/sites/pages/:pageId", rateLimits: LIMITS.tenantWrite, maxBodyBytes: 512 * 1024 }, async ({ req, ctx }, { orgId, companyId, pageId }) => {
  const r = await savePage(ctx, orgId, companyId, pageId, await body(req, savePageInput));
  if (r.slugChanged) refreshSite((await db().site.findFirst({ where: { organizationId: orgId, companyId }, select: { slug: true } }))?.slug);
  return r;
});

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/sites/pages/:pageId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, pageId }) => {
  const r = await deletePage(ctx, orgId, companyId, pageId);
  refreshSite(r.siteSlug);
  return r;
});
