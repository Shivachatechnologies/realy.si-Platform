import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { directInput, openDirect } from "@/server/modules/comms/channels";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/direct", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => openDirect(ctx, orgId, companyId, await body(req, directInput)),
);
