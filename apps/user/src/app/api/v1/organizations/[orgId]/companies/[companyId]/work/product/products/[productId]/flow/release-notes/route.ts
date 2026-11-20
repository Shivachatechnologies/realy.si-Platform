import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { draftReleaseNotes } from "@/server/modules/work/product-flow";

type P = { orgId: string; companyId: string; productId: string };

/** POST — write release notes from the completed and planned work into the open (or a new planned) release. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/flow/release-notes", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, productId }) => draftReleaseNotes(ctx, orgId, companyId, productId),
);
