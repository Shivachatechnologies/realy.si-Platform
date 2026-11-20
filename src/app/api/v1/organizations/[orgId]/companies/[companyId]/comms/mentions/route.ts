import { route } from "@/server/core/http";
import { listMentions, type MentionKind } from "@/server/modules/comms/hub";

type P = { orgId: string; companyId: string };
const KINDS: MentionKind[] = ["message", "post", "comment", "task_comment"];
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const sp = req.nextUrl.searchParams;
  const kind = KINDS.find((k) => k === sp.get("kind"));
  return listMentions(ctx, orgId, companyId, { before: sp.get("before") ? new Date(sp.get("before")!) : undefined, kind });
});
