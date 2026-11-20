import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { lookupInput, lookupPeople } from "@/server/modules/crm/prospecting";

type P = { orgId: string; companyId: string };

/** Live "who works there?" lookup through the connected contact-data provider (nothing is stored). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/prospecting/lookup", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => lookupPeople(ctx, orgId, companyId, (await body(req, lookupInput)) as z.input<typeof lookupInput>),
);
