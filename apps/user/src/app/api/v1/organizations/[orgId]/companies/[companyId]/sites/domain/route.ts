import { z } from "zod";
import { body, route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { removeDomain, setDomain, verifyDomain } from "@/server/modules/sites/domain";

type P = { orgId: string; companyId: string };
const input = z.discriminatedUnion("action", [z.object({ action: z.literal("set"), domain: z.string() }), z.object({ action: z.literal("verify") }), z.object({ action: z.literal("remove") })]);

/** Custom domain: set (returns the TXT record to add), verify (real DNS lookup) or remove. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/sites/domain", rateLimits: [...LIMITS.tenantWrite, { name: "site-domain:principal", limit: 20, windowMs: 60_000, by: "principal" }] },
  async ({ req, ctx }, { orgId, companyId }) => {
    const r = input.parse(await body(req, input));
    if (r.action === "set") return setDomain(ctx, orgId, companyId, { domain: r.domain });
    if (r.action === "verify") return verifyDomain(ctx, orgId, companyId);
    return removeDomain(ctx, orgId, companyId);
  },
);
