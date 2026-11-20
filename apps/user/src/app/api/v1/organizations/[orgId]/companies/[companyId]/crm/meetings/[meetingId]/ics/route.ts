import { route } from "@/server/core/http";
import { meetingIcs } from "@/server/modules/crm/meetings";

type P = { orgId: string; companyId: string; meetingId: string };

/** GET the meeting as a calendar file (.ics). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, meetingId }) => {
  const f = await meetingIcs(ctx, orgId, companyId, meetingId);
  return new Response(f.body, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${encodeURIComponent(f.filename)}"`, "cache-control": "private, no-store" },
  });
});
