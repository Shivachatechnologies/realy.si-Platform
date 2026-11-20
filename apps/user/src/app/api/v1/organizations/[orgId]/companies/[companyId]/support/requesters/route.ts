import { route } from "@/server/core/http";
import { searchRequesters } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => searchRequesters(ctx, orgId, companyId, req.nextUrl.searchParams.get("q") ?? ""));
