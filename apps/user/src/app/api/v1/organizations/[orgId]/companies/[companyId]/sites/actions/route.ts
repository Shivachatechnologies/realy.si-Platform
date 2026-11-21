import { z } from "zod";
import { body, route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { setSiteOnline } from "@/server/modules/sites/service";
import { refreshSite } from "@/components/sites/cache";

type P = { orgId: string; companyId: string };
const input = z.object({ action: z.enum(["go_online", "go_offline"]) });

/** Take the whole site online or offline. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/sites/actions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => {
  const { action } = input.parse(await body(req, input));
  const r = await setSiteOnline(ctx, orgId, companyId, action === "go_online");
  refreshSite(r.slug);
  return r;
});
