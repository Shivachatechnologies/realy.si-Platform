import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { unlinkDocument } from "@/server/modules/brain/links";

type P = { orgId: string; companyId: string; linkId: string };

export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/brain/links/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, linkId }) => unlinkDocument(ctx, orgId, companyId, linkId),
);
