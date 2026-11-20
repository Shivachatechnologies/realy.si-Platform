import { route } from "@/server/core/http";
import { voiceAnalytics } from "@/server/modules/voice/analytics";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  return voiceAnalytics(ctx, orgId, companyId, days);
});
