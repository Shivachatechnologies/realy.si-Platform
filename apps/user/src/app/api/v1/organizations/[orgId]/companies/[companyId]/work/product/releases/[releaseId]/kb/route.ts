import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { createReleaseKbDraft } from "@/server/modules/work/product-delivery";

type P = { orgId: string; companyId: string; releaseId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/releases/:releaseId/kb", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, releaseId }) => createReleaseKbDraft(ctx, orgId, companyId, releaseId));

