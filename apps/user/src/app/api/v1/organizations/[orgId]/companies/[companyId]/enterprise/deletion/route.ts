import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deletionRequestInput, listDataRequests, requestDeletion } from "@/server/modules/enterprise/data";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({
  data: await listDataRequests(ctx, orgId, companyId),
}));
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/companies/:companyId/enterprise/deletion",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ req, ctx }, { orgId, companyId }) => requestDeletion(ctx, orgId, companyId, await body(req, deletionRequestInput)),
);
