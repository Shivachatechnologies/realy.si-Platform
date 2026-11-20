import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { createLaunchCampaign } from "@/server/modules/work/product-delivery";

type P = { orgId: string; companyId: string; productId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/campaign", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, productId }) => createLaunchCampaign(ctx, orgId, companyId, productId));

