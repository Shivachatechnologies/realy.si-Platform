import { route } from "@/server/core/http";
import { searchContacts } from "@/server/modules/marketing/segments";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await searchContacts(ctx, orgId, companyId, req.nextUrl.searchParams.get("q")?.trim().slice(0, 200) || undefined) }));
