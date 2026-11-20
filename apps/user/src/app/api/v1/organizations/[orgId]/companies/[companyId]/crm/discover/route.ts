import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { discoverInput, discoverProspects, listProspectSearches } from "@/server/modules/crm/discovery";

type P = { orgId: string; companyId: string };

/** GET recent discovery runs; POST runs a new web search through the connected research provider. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listProspectSearches(ctx, orgId, companyId) }));

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/discover", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => discoverProspects(ctx, orgId, companyId, (await body(req, discoverInput)) as z.input<typeof discoverInput>),
);
