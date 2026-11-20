import { route } from "@/server/core/http";
import { invalid } from "@/server/core/errors";
import { calendarFeed } from "@/server/modules/marketing/calendar";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const from = new Date(req.nextUrl.searchParams.get("from") ?? "");
  const to = new Date(req.nextUrl.searchParams.get("to") ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 100 * 86_400_000) throw invalid("Give from and to (at most 100 days apart)");
  return { data: await calendarFeed(ctx, orgId, companyId, from, to) };
});
