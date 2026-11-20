import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addSuppression, addSuppressions, listSuppressions, suppressionBulkInput } from "@/server/modules/crm/suppression";

type P = { orgId: string; companyId: string };

const postInput = z.union([suppressionBulkInput, z.object({ value: z.string().trim().max(254), reason: z.string().optional(), note: z.string().optional() })]);

/** GET the sales do-not-contact list (?q=); POST adds one address/domain ({ value }) or a pasted list ({ values }). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 120) ?? undefined;
  return listSuppressions(ctx, orgId, companyId, { q });
});

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/suppressions", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => {
    const input = await body(req, postInput);
    if ("values" in input) return addSuppressions(ctx, orgId, companyId, input);
    return addSuppression(ctx, orgId, companyId, input as Parameters<typeof addSuppression>[3]);
  },
);
