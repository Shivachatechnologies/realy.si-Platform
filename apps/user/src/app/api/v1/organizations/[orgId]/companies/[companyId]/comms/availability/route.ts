import { route } from "@/server/core/http";
import { availability } from "@/server/modules/crm/meeting-intel";

type P = { orgId: string; companyId: string };

/** Free meeting slots from the connected calendar(s), Realy meetings and Calendly. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const sp = req.nextUrl.searchParams;
  const n = (k: string) => (sp.get(k) && Number.isFinite(Number(sp.get(k))) ? Number(sp.get(k)) : undefined);
  return availability(ctx, orgId, companyId, { days: n("days"), durationMin: n("duration"), workStartHour: n("start"), workEndHour: n("end") });
});
