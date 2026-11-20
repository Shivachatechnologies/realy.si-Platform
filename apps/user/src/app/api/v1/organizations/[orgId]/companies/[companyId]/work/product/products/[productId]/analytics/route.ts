import { route } from "@/server/core/http";
import { productAnalytics } from "@/server/modules/work/product-delivery";

type P = { orgId: string; companyId: string; productId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, productId }) => productAnalytics(ctx, orgId, companyId, productId));

