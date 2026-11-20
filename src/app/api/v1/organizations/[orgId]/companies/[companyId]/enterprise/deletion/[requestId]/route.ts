import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { actOnDeletion, deletionActionInput } from "@/server/modules/enterprise/data";

type P = { orgId: string; companyId: string; requestId: string };

/** { action: "confirm", confirmName } (companies.delete) or { action: "cancel" }. */
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/companies/:companyId/enterprise/deletion/:requestId",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ req, ctx }, p) => actOnDeletion(ctx, p.orgId, p.companyId, p.requestId, await body(req, deletionActionInput)),
);
