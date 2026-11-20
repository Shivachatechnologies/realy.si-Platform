import { route } from "@/server/core/http";
import { listActivity } from "@/server/modules/activity/service";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId }) => {
  const r = await listActivity(ctx, orgId, Object.fromEntries(req.nextUrl.searchParams));
  return { data: r.data.map((a) => ({ ...a, actorName: a.actorId ? (r.actors.get(a.actorId) ?? null) : null })), nextCursor: r.nextCursor };
});
