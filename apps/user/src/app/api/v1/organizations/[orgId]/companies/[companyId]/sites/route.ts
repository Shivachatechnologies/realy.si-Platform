import { body, route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { createSite, createSiteInput, getSiteOverview, updateSite, updateSiteInput } from "@/server/modules/sites/service";
import { generateWebsite } from "@/server/modules/sites/ai";
import { refreshSite } from "@/components/sites/cache";

type P = { orgId: string; companyId: string };

/** The company's website overview (site or null, pages, new submissions). */
export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/companies/:companyId/sites" }, async ({ ctx }, { orgId, companyId }) => getSiteOverview(ctx, orgId, companyId));

/** Guided setup: create the site with its theme and starter pages (drafts). start=ai also asks the web designer AI to draft the pages. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/sites", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => {
  const input = await body(req, createSiteInput);
  const site = await createSite(ctx, orgId, companyId, input);
  let taskId: string | null = null;
  let aiError: unknown = null;
  if (input.start === "ai") {
    try {
      taskId = (await generateWebsite(ctx, orgId, companyId, {})).taskId;
    } catch (err) {
      aiError = err;
    }
  }
  return { ...site, taskId, aiStarted: !!taskId, aiError: aiError ? (aiError instanceof Error ? aiError.message : "ai_failed") : null };
});

/** Name, address, locale, theme, navigation, footer, SEO defaults. */
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/sites", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId }) => {
  const r = await updateSite(ctx, orgId, companyId, await body(req, updateSiteInput));
  refreshSite(r.site.slug, r.previousSlug);
  return r.site;
});
