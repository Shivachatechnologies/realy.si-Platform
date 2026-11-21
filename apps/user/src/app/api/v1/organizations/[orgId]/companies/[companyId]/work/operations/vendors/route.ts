import { route } from "@/server/core/http";
import { listVendors } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listVendors(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
