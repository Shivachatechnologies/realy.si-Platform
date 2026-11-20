import { route } from "@/server/core/http";
import { listReports } from "@/server/modules/briefing/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listReports(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
