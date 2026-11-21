import { route } from "@/server/core/http";
import { productFlow } from "@/server/modules/work/product-flow";

type P = { orgId: string; companyId: string; productId: string };

/** GET — the "Build with AI" guided flow state (all stages from real records). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, productId }) => productFlow(ctx, orgId, companyId, productId));
