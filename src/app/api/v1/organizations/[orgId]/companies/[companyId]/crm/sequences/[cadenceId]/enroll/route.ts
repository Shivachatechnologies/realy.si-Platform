import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { enroll, enrollInput } from "@/server/modules/crm/cadences";

type P = { orgId: string; companyId: string; cadenceId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/sequences/:cadenceId/enroll", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, cadenceId }) => enroll(ctx, orgId, companyId, cadenceId, (await body(req, enrollInput)) as z.input<typeof enrollInput>),
);
