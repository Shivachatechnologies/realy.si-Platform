import type { Metadata } from "next";
import { AbSettings, VariantForm } from "@/components/marketing/studio-forms";
import { Notice } from "@/components/ui/notice";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { EmailActions, EmailCampaignEditor } from "@/components/marketing/email-forms";
import { Kpi, MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { getEmailCampaign, emailDeliveryReady } from "@/server/modules/marketing/email";
import { listSegments } from "@/server/modules/marketing/segments";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.email") };
}

const SEND_STATUSES = ["SENT", "FAILED", "NOT_CONFIGURED", "PENDING"] as const;

export default async function EmailCampaignPage({ params, searchParams }: PageProps<"/[locale]/marketing/email/[emailCampaignId]">) {
  const { emailCampaignId } = await params;
  const sp = await searchParams;
  const sendFilter = typeof sp.status === "string" ? sp.status : undefined;
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/email`, label: t("marketing.email.title") };
  if (m.blocked) return <MarketingShell locale={locale} t={t} tab="email" title={t("marketing.email.title")} back={back} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const d = await getEmailCampaign(viewer.ctx, org.id, company.id, emailCampaignId, sendFilter).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const c = d.campaign;
  const editable = canManage && ["DRAFT", "SCHEDULED", "FAILED"].includes(c.status);
  const [segments, campaigns] = editable ? await Promise.all([listSegments(viewer.ctx, org.id, company.id), campaignOptions(viewer.ctx, org.id, company.id)]) : [[], []];
  const s = d.stats;
  const rate = (n: number) => (s.sent ? `${formatNumber(Math.round((n / s.sent) * 1000) / 10, locale)}%` : "—");
  const path = `/${locale}/marketing/email/${c.id}`;

  return (
    <MarketingShell
      locale={locale}
      t={t}
      tab="email"
      back={back}
      title={c.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={c.status} label={t(`marketing.emailStatus.${c.status}`)} />
          {c.scheduledAt && c.status === "SCHEDULED" ? <span className="text-xs">{t("marketing.content.scheduledFor", { date: formatDateTime(c.scheduledAt, locale, tz) })}</span> : null}
          {c.finishedAt ? <span className="text-xs">{t("marketing.email.finishedAt", { date: formatDateTime(c.finishedAt, locale, tz) })}</span> : null}
          {c.campaign ? (
            <Link href={`/${locale}/marketing/campaigns/${c.campaign.id}`} className="text-xs hover:underline">
              · {c.campaign.name}
            </Link>
          ) : null}
        </span>
      }
      actions={canManage && ["DRAFT", "CANCELLED"].includes(c.status) ? <ActionButton path={`${base}/email/campaigns/${c.id}`} method="DELETE" variant="ghost" label={t("marketing.common.delete")} confirm={t("marketing.common.confirmDelete")} redirectTo={back.href} /> : null}
    >
      <AutoRefresh active={c.status === "SENDING"} intervalMs={5000} />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("marketing.email.stats.sent")} value={s.sent} />
        <Kpi label={t("marketing.email.stats.failed")} value={s.failed} />
        <Kpi label={t("marketing.email.stats.notConfigured")} value={s.notConfigured} />
        <Kpi label={t("marketing.email.stats.opened")} value={s.opened} hint={rate(s.opened)} />
        <Kpi label={t("marketing.email.stats.clicked")} value={s.clicked} hint={rate(s.clicked)} />
        <Kpi label={t("marketing.email.stats.unsubscribed")} value={s.unsubscribed} hint={rate(s.unsubscribed)} />
      </div>
      {canManage ? (
        <Card>
          <CardHeader title={t("marketing.email.sending")} description={c.segment ? t("marketing.email.toSegment", { name: c.segment.name }) : t("marketing.email.noSegment")} />
          <EmailActions base={base} id={c.id} status={c.status} audience={d.audience} emailReady={(await emailDeliveryReady(org.id, company.id, d.campaign.provider))} />
        </Card>
      ) : null}
      {editable ? (
        <Card>
          <CardHeader title={t("marketing.email.message")} />
          <EmailCampaignEditor
            base={base}
            initial={{ id: c.id, name: c.name, subject: c.subject, body: c.body, segmentId: c.segmentId ?? "", campaignId: c.campaignId ?? "" }}
            segments={segments.map((x) => ({ id: x.id, name: x.name }))}
            campaigns={campaigns}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader title={c.subject || t("marketing.email.message")} />
          <pre className="whitespace-pre-wrap p-4 font-sans text-sm">{c.body}</pre>
        </Card>
      )}
      <Card>
        <CardHeader title={t("marketing.email.sendLog")} description={t("marketing.email.sendLogHint")} />
        <div className="flex flex-wrap gap-2 border-b p-3 text-xs">
          <Link href={path} className={`rounded-md border px-2 py-1 ${!sendFilter ? "bg-muted" : ""}`}>
            {t("common.all")}
          </Link>
          {SEND_STATUSES.map((st) => (
            <Link key={st} href={`${path}?status=${st}`} className={`rounded-md border px-2 py-1 ${sendFilter === st ? "bg-muted" : ""}`}>
              {t(`marketing.sendStatus.${st}`)}
            </Link>
          ))}
        </div>
        {d.sends.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("marketing.email.noSends")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.email.recipient")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("marketing.email.sentAt")}</Th>
                <Th>{t("marketing.email.engagement")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.sends.map((x) => (
                <Tr key={x.id}>
                  <Td>{x.email}</Td>
                  <Td>
                    <StatusBadge status={x.status} label={t(`marketing.sendStatus.${x.status}`)} />
                  </Td>
                  <Td className="text-xs text-muted-foreground">{formatDateTime(x.createdAt, locale, tz)}</Td>
                  <Td className="text-xs">
                    {[x.openedAt ? t("marketing.email.openedN", { count: x.openCount }) : null, x.clickedAt ? t("marketing.email.clickedN", { count: x.clickCount }) : null, x.unsubscribedAt ? t("marketing.email.stats.unsubscribed") : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("marketing.studio.email.abTitle")} description={t("marketing.studio.email.abHint")} />
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            {!d.providerReady ? <Notice tone="warning">{t("marketing.studio.email.providerNotReady")}</Notice> : null}
            {editable ? <AbSettings base={base} id={c.id} initial={{ provider: c.provider, abEnabled: c.abEnabled, abTestPercent: c.abTestPercent, abMetric: c.abMetric, abWaitHours: c.abWaitHours }} /> : <p className="text-sm">{t(`marketing.studio.email.providers.${c.provider}`)}{c.abEnabled ? ` · ${t("marketing.studio.email.abEnabled")}` : ""}</p>}
            {c.abPhase ? <p className="text-xs text-muted-foreground">{t(`marketing.studio.email.phase.${c.abPhase}`)}</p> : null}
          </div>
          <div className="grid content-start gap-3">
            <ul className="grid gap-2 text-sm">
              {c.variants.map((v) => {
                const r = d.variantStats[v.id];
                return (
                  <li key={v.id} className={`grid gap-1 rounded-md border p-2 ${c.abWinnerVariantId === v.id ? "border-success" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {v.label}: {v.subject}
                      </span>
                      {c.abWinnerVariantId === v.id ? <span className="text-xs text-success">{t("marketing.studio.email.winner")}</span> : null}
                    </div>
                    {r ? <p className="text-xs text-muted-foreground">{t("marketing.studio.email.variantStats", { sent: r.sent, open: (r.openRate * 100).toFixed(1), click: (r.clickRate * 100).toFixed(1) })}</p> : null}
                    {editable ? <ActionButton path={`${base}/email/campaigns/${c.id}/variants/${v.id}`} method="DELETE" variant="ghost" label={t("marketing.common.delete")} confirm={t("marketing.common.confirmDelete")} /> : null}
                  </li>
                );
              })}
            </ul>
            {editable && c.variants.length < 4 ? <VariantForm base={base} emailCampaignId={c.id} /> : null}
            <p className="text-[11px] text-muted-foreground">{t("marketing.studio.email.tokens")}</p>
          </div>
        </div>
      </Card>
    </MarketingShell>
  );
}
