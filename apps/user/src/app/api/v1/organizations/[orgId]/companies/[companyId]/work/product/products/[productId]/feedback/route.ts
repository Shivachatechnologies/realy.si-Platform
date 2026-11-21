import { route } from "@/server/core/http";
import { productFeedback } from "@/server/modules/work/product-delivery";

type P = { orgId: string; companyId: string; productId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, productId }) => productFeedback(ctx, orgId, companyId, productId, Object.fromEntries(req.nextUrl.searchParams)));

