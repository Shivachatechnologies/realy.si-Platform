import { route } from "@/server/core/http";
import { downloadUrl } from "@/server/modules/creative/library";

type P = { orgId: string; companyId: string; assetId: string };
/** GET — redirects to a short-lived signed URL of the asset's file. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, assetId }) => {
  const url = await downloadUrl(ctx, orgId, companyId, assetId);
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
});
