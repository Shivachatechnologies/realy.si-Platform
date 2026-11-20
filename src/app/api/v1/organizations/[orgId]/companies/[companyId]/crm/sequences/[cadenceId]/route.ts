import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { cadencePatch, getCadence, updateCadence } from "@/server/modules/crm/cadences";

type P = { orgId: string; companyId: string; cadenceId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, cadenceId }) => getCadence(ctx, orgId, companyId, cadenceId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/sequences/:cadenceId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, cadenceId }) => updateCadence(ctx, orgId, companyId, cadenceId, (await body(req, cadencePatch)) as z.input<typeof cadencePatch>),
);
