import { route } from "@/server/core/http";
import { interviewIcs } from "@/server/modules/hr/interview-calendar";

type P = { orgId: string; companyId: string; id: string };

/** The interview as an .ics file (add it to any calendar by hand). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => {
  const ics = await interviewIcs(ctx, orgId, companyId, id);
  return new Response(ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="interview-${id.slice(0, 8)}.ics"`, "cache-control": "private, no-store" },
  });
});
