import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { MEETING_TONE } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { MeetingIntelPanel, type IntelData } from "@/components/comms/meeting-intel";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getMeetingIntel } from "@/server/modules/crm/meeting-intel";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.intel.customerTitle") };
}

export default async function CustomerMeetingPage({ params }: PageProps<"/[locale]/communication/meetings/customer/[meetingId]">) {
  const { meetingId } = await params;
  const p = await areaPage("communication", "meetings");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const chain = await companyChain(db(), org.id, company.id);
  const [salesRead, salesManage] = await Promise.all([can(viewer.ctx, "sales.read", chain), can(viewer.ctx, "sales.manage", chain)]);
  if (!salesRead) return wrap(<Notice tone="warning">{t("communication.intel.noSales")}</Notice>);
  const raw = await getMeetingIntel(viewer.ctx, org.id, company.id, "CRM", meetingId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const data = JSON.parse(JSON.stringify(raw, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as IntelData;
  const m = raw.meeting;
  const subject = m.leadId ? `/${locale}/crm/${m.leadId}` : m.contactId ? `/${locale}/crm/contacts/${m.contactId}` : null;
  return wrap(
    <div className="grid gap-4">
      <Link href={`/${locale}/communication/meetings/customer`} className="text-sm text-muted-foreground hover:text-foreground">← {t("communication.intel.customerBack")}</Link>
      <Card>
        <CardHeader title={<span className="flex flex-wrap items-center gap-2">{m.title}<Badge tone={MEETING_TONE[m.status]}>{t(`communication.meetings.statuses.${m.status}`)}</Badge></span>} description={`${formatDateTime(m.startsAt, locale, tz)} · ${m.attendeeName ?? m.attendeeEmail ?? "—"}`} actions={subject ? <Link href={subject} className="text-sm font-medium text-primary hover:underline">{t("communication.intel.openCrm")}</Link> : undefined} />
        {m.outcome ? <CardBody><p className="text-sm"><span className="text-muted-foreground">{t("communication.intel.outcome")}: </span>{m.outcome}</p></CardBody> : null}
      </Card>
      {!perms.runAgents ? <Notice>{t("communication.ai.noPermission")}</Notice> : null}
      <MeetingIntelPanel base={base} kind="crm" data={data} canEdit={salesManage && perms.runAgents} aiReady={perms.aiReady} locale={locale} tz={tz} />
    </div>,
  );
}
