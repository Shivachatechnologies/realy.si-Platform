import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getMyPublisher, publisherInput, upsertPublisher } from "@/server/modules/marketplace/service";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId }) => ({ data: await getMyPublisher(ctx, orgId) }));
export const PUT = route<P>(
  {
    auth: "required",
    name: "PUT /organizations/:orgId/marketplace/publisher",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId }) => upsertPublisher(ctx, orgId, await body(req, publisherInput)),
);
