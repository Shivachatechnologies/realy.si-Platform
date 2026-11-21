import { route } from "@/server/core/http";
import { callMeetingFunnel } from "@/server/modules/voice/analytics";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const days = [7, 30, 90].find((d) => String(d) === req.nextUrl.searchParams.get("days")) ?? 30;
  return callMeetingFunnel(ctx, orgId, companyId, days);
});
