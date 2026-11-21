import { route } from "@/server/core/http";
import { customerConversations } from "@/server/modules/comms/customer-context";

type P = { orgId: string; companyId: string };

/** Email conversations linked to a CRM contact (?contactId=) or every contact of an account (?accountId=). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const sp = new URL(req.url).searchParams;
  return { data: await customerConversations(ctx, orgId, companyId, { contactId: sp.get("contactId") ?? undefined, accountId: sp.get("accountId") ?? undefined }) };
});
