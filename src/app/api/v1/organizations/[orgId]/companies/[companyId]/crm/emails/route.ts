import { route } from "@/server/core/http";
import { invalid } from "@/server/core/errors";
import { emailTimeline, type EmailSubject } from "@/server/modules/crm/emails";

type P = { orgId: string; companyId: string };
const TYPES: EmailSubject[] = ["lead", "contact", "account", "deal"];

/** GET ?type=lead|contact|account|deal&id=&page= — unified email history of a record, newest first. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const q = req.nextUrl.searchParams;
  const type = q.get("type") as EmailSubject;
  if (!TYPES.includes(type)) throw invalid("Unknown record type");
  const r = await emailTimeline(ctx, orgId, companyId, type, q.get("id") ?? "", Math.max(1, Math.min(25, Number(q.get("page")) || 1)));
  return { data: r.items, total: r.total, page: r.page, pageSize: r.pageSize };
});
