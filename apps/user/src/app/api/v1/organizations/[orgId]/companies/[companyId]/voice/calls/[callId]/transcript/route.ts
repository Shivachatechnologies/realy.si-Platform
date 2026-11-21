import { route } from "@/server/core/http";
import { transcriptSince } from "@/server/modules/voice/live";

type P = { orgId: string; companyId: string; callId: string };

/** Incremental transcript: lines stored after the `after` cursor (ms epoch). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, callId }) => {
  const after = Number(req.nextUrl.searchParams.get("after"));
  return transcriptSince(ctx, orgId, companyId, callId, Number.isFinite(after) && after > 0 ? after : null);
});
