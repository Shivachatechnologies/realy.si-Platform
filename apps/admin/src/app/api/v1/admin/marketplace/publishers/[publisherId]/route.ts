import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { publisherVerifyInput, setPublisherVerified } from "@/server/modules/admin/marketplace";

export const PUT = route<{ publisherId: string }>({ auth: "required", name: "PUT /admin/marketplace/publishers/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { publisherId }) =>
  setPublisherVerified(ctx, publisherId, await body(req, publisherVerifyInput)),
);
