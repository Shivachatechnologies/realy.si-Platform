import { route } from "@/server/core/http";
import { listInsights } from "@/server/modules/growth/service";

export const GET = route<{ orgId: string; companyId: string }>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listInsights(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
