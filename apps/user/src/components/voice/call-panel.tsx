import "server-only";
import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import type { AppLocale } from "@/i18n/config";
import { formatRelativeTime } from "@/i18n/format";
import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { subjectCalls } from "@/server/modules/voice/calls";
import { isDoNotCall } from "@/server/modules/voice/service";
import { toE164 } from "@/server/modules/voice/common";
import { CallButton } from "./client";
import { OUTCOME_TONE, STATUS_TONE } from "./bits";

/**
 * "AI phone calls" card for CRM lead and contact pages: the call-with-AI button (or why calling isn't possible) and the
 * record's recent calls. Server component — mount it on the CRM page with the page's viewer context:
 *   <VoiceCallPanel ctx={viewer.ctx} organizationId={org.id} companyId={company.id} locale={locale} subject={{ leadId: lead.id }} />
 * Renders nothing when the viewer can't see calls.
 */
export async function VoiceCallPanel({ ctx, organizationId, companyId, locale, subject }: { ctx: RequestContext; organizationId: string; companyId: string; locale: AppLocale; subject: { leadId: string } | { contactId: string } }) {
  const chain = await companyChain(db(), organizationId, companyId);
  const [read, post, approve] = await Promise.all([can(ctx, "communication.read", chain), can(ctx, "communication.post", chain), can(ctx, "approvals.decide", chain)]);
  if (!read) return null;
  const t = await getT(locale);
  const leadId = "leadId" in subject ? subject.leadId : undefined;
  const contactId = "contactId" in subject ? subject.contactId : undefined;
  const record = leadId
    ? await db().lead.findFirst({ where: { id: leadId, organizationId, companyId }, select: { name: true, phone: true, tags: true } })
    : await db().contact.findFirst({ where: { id: contactId, organizationId, companyId }, select: { firstName: true, lastName: true, phone: true, tags: true } }).then((c) => (c ? { name: [c.firstName, c.lastName].filter(Boolean).join(" "), phone: c.phone, tags: c.tags } : null));
  if (!record) return null;
  const [agents, calls] = await Promise.all([
    db().voiceAgent.findMany({ where: { organizationId, companyId, archivedAt: null, syncStatus: "SYNCED", goal: { not: "RECEPTIONIST" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, provider: true } }),
    subjectCalls(ctx, organizationId, companyId, { leadId, contactId }),
  ]);
  const numbers = await db().voicePhoneNumber.count({ where: { organizationId, companyId, releasedAt: null, provider: { in: [...new Set(agents.map((a) => a.provider))] } } });
  const phone = toE164(record.phone);
  const reason = !post ? "forbidden" : !record.phone ? "noPhone" : !phone ? "badPhone" : (await isDoNotCall(db(), companyId, phone, record)) ? "dnc" : !agents.length ? "noAgent" : !numbers ? "noNumber" : null;
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}`;
  return (
    <Card>
      <CardHeader
        icon={<PhoneCall />}
        title={t("voice.panel.title")}
        description={t("voice.panel.description")}
        actions={<CallButton base={base} locale={locale} agents={agents.map((a) => ({ id: a.id, name: a.name }))} subject={{ leadId, contactId, name: record.name }} canApprove={approve} disabledReason={reason} size="sm" />}
      />
      <CardBody className="grid gap-2">
        {calls.length ? (
          <ul className="grid gap-2">
            {calls.map((c) => (
              <li key={c.id}>
                <Link href={`/${locale}/voice/calls/${c.id}`} className="grid gap-1 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{t(`voice.status.${c.status}`)}</Badge>
                    {c.outcome ? <Badge tone={OUTCOME_TONE[c.outcome] ?? "neutral"}>{t(`voice.outcomes.${c.outcome}`)}</Badge> : null}
                    <span className="ms-auto text-xs text-muted-foreground">{formatRelativeTime(c.createdAt, locale)}</span>
                  </span>
                  {c.summary ? <span className="line-clamp-2 text-muted-foreground">{c.summary}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("voice.panel.empty")}</p>
        )}
        {reason === "noAgent" || reason === "noNumber" ? (
          <Link href={`/${locale}/voice/setup`} className="text-sm font-medium text-primary hover:underline">
            {t("voice.panel.setup")}
          </Link>
        ) : null}
      </CardBody>
    </Card>
  );
}
