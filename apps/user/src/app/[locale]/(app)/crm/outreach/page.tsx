import type { Metadata } from "next";
import Link from "next/link";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { OutreachCard, OutreachComposer, type RecipientOption } from "@/components/crm/revenue/outreach";
import { ConnectNotice, canSendWith, toOutreachView } from "@/components/crm/revenue/panels";
import { EngineStatus, Figure } from "@/components/crm/revenue/visuals";
import { getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { revenueChannels } from "@/server/modules/crm/channels";
import { param, pick } from "@/server/modules/crm/common";
import { contactName } from "@/server/modules/crm/contacts";
import { listOutreach, outreachStats, OUTREACH_STATUSES } from "@/server/modules/crm/outreach";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.outreach") };
}

/** Outreach: write or AI-draft personal emails, approve them, send through your own connected email. */
export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="outreach">{null}</CrmFrame>;
  const { t, locale, tz, org, company, viewer, base } = c;
  const q = await searchParams;
  const status = pick(param(q, "status"), OUTREACH_STATUSES) ?? "PENDING_APPROVAL";
  const [channels, stats, messages, leads, contacts] = await Promise.all([
    revenueChannels(org.id, company.id),
    outreachStats(viewer.ctx, org.id, company.id),
    listOutreach(viewer.ctx, org.id, company.id, { status, take: 60 }),
    c.canManage ? db().lead.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null, convertedAt: null, email: { not: null } }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, name: true, account: true } }) : [],
    c.canManage ? db().contact.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null, email: { not: null } }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, firstName: true, lastName: true, account: { select: { name: true } } } }) : [],
  ]);
  const options: RecipientOption[] = [
    ...leads.map((l) => ({ value: `lead:${l.id}`, label: [l.name, l.account].filter(Boolean).join(" · "), group: "lead" as const })),
    ...contacts.map((x) => ({ value: `contact:${x.id}`, label: [contactName(x), x.account?.name].filter(Boolean).join(" · "), group: "contact" as const })),
  ];
  const canSend = c.canManage && canSendWith(channels);
  const pct = (v: number | null) => (v == null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: 0 }));
  return (
    <CrmFrame active="outreach" eyebrow={t("crm.rev.outreach.eyebrow")} title={t("crm.rev.outreach.title")} subtitle={t("crm.rev.outreach.subtitle")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label={t("crm.rev.outreach.kpi.pending")} value={stats.pending} caption={t("crm.rev.outreach.kpi.pendingHint")} tone={stats.pending ? "warning" : undefined} />
        <Figure label={t("crm.rev.outreach.kpi.sent")} value={stats.sent} caption={t("crm.rev.outreach.kpi.sentHint", { people: stats.people })} />
        <Figure label={t("crm.rev.outreach.kpi.replies")} value={stats.replied} caption={t("crm.rev.outreach.kpi.repliesHint")} />
        <Figure label={t("crm.rev.outreach.kpi.rate")} value={pct(stats.replyRate)} caption={t("crm.rev.outreach.kpi.rateHint")} tone="primary" />
      </div>
      {!canSendWith(channels) ? <ConnectNotice locale={locale} text={t("crm.rev.outreach.noChannel")} connect={t("crm.rev.connect")} /> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid content-start gap-3" aria-labelledby="queue-h">
          <h2 id="queue-h" className="font-display text-2xl">{t("crm.rev.outreach.queue")}</h2>
          <nav className="flex gap-1 overflow-x-auto" aria-label={t("crm.rev.outreach.queue")}>
            {OUTREACH_STATUSES.map((s) => (
              <Link key={s} href={`/${locale}/crm/outreach?status=${s}`} aria-current={status === s ? "page" : undefined} className={cn("min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-sm", status === s ? "border-primary bg-primary text-primary-foreground" : "bg-surface hover:bg-muted")}>
                {t(`crm.rev.outreach.status.${s}`)}
              </Link>
            ))}
          </nav>
          {messages.length ? (
            <div className="grid gap-3">
              {messages.map((m) => (
                <OutreachCard key={m.id} base={base} locale={locale} m={toOutreachView(m, locale, tz)} canManage={c.canManage} canSend={canSend} />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{t(`crm.rev.outreach.empty.${status}`)}</p>
          )}
        </section>
        <aside className="grid content-start gap-4">
          {c.canManage ? (
            <section className="grid gap-3 rounded-xl border bg-surface p-4 shadow-elev-1">
              <h2 className="font-display text-lg">{t("crm.rev.outreach.compose")}</h2>
              <OutreachComposer base={base} locale={locale} options={options} aiText={channels.aiText.length > 0} canSend={canSend} />
            </section>
          ) : null}
          <EngineStatus channels={channels} locale={locale} t={t} />
        </aside>
      </div>
    </CrmFrame>
  );
}
