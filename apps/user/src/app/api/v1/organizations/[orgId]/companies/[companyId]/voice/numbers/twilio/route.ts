import { route } from "@/server/core/http";
import { twilioOptions } from "@/server/modules/voice/numbers";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const sp = req.nextUrl.searchParams;
  return twilioOptions(ctx, orgId, companyId, { country: (sp.get("country") ?? "US").toUpperCase(), areaCode: sp.get("areaCode") || undefined });
});
