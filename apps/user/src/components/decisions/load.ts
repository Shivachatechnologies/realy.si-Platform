import "server-only";
import { db } from "@/server/core/db";
import type { Translate } from "@/i18n/translate";
import type { ApprovalRow } from "./decision-card";
import { describeAction, type ActionPreview } from "./describe";

/**
 * Previews for a set of approvals: resolves the people / records they name (only inside this company) so each request
 * reads "Send this email to Ana Novak", plus the names of the people who decided.
 */
export async function loadDecisionPreviews(rows: ApprovalRow[], o: { organizationId: string; companyId: string; t: Translate; locale: string; currency: string; timeZone: string }) {
  const leadIds = [...new Set(rows.map((a) => (a.input as { leadId?: unknown } | null)?.leadId).filter((v): v is string => typeof v === "string"))];
  const deciderIds = [...new Set(rows.map((a) => a.decidedById).filter((v): v is string => !!v))];
  const [leads, users] = await Promise.all([
    leadIds.length ? db().lead.findMany({ where: { organizationId: o.organizationId, companyId: o.companyId, id: { in: leadIds } }, select: { id: true, name: true, email: true } }) : [],
    deciderIds.length ? db().user.findMany({ where: { id: { in: deciderIds } }, select: { id: true, name: true } }) : [],
  ]);
  const leadMap = new Map(leads.map((l) => [l.id, { name: l.name, email: l.email }]));
  const names = new Map(users.map((u) => [u.id, u.name]));
  const previews = new Map<string, ActionPreview>(rows.map((a) => [a.id, describeAction(a.tool, a.input, a.summary, { t: o.t, locale: o.locale, currency: o.currency, timeZone: o.timeZone, leads: leadMap })]));
  return { previews, names };
}
