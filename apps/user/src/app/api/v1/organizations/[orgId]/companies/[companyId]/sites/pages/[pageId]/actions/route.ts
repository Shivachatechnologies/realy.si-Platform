import { z } from "zod";
import { body, route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { PAGE_ACTIONS, pageAction, pageActionInput } from "@/server/modules/sites/service";
import { refreshSite } from "@/components/sites/cache";

type P = { orgId: string; companyId: string; pageId: string };
const input = pageActionInput.extend({ action: z.enum(PAGE_ACTIONS) });

/** publish | schedule | unpublish | cancel_schedule | rollback (to a version, optionally publishing it). */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/sites/pages/:pageId/actions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, pageId }) => {
  const { action, ...rest } = input.parse(await body(req, input));
  const r = await pageAction(ctx, orgId, companyId, pageId, action, rest);
  refreshSite(r.siteSlug);
  return r;
});
