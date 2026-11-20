import { route } from "@/server/core/http";
import { searchContacts } from "@/server/modules/comms/email";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await searchContacts(ctx, orgId, companyId, req.nextUrl.searchParams.get("q") ?? "") }));
