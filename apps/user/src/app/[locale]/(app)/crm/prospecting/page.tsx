import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Building2, ExternalLink, History, Inbox, Users } from "lucide-react";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { ConnectNotice } from "@/components/crm/revenue/panels";
import { Figure } from "@/components/crm/revenue/visuals";
import { AutopilotControls, EditAutopilot, NewAutopilot, SuppressionManager } from "@/components/crm/prospecting/actions";
import { ProspectingFunnel, ProviderStatus } from "@/components/crm/prospecting/visuals";
import { EmailBadge } from "@/components/crm/prospecting/wizard";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import { providerInfo } from "@/server/modules/integrations/catalog";
import { contactProviderStatus } from "@/server/modules/integrations/services/contacts";
import { revenueChannels } from "@/server/modules/crm/channels";
import { param } from "@/server/modules/crm/common";
import { companyFunnel, getAutopilot, listAutopilots } from "@/server/modules/crm/prospecting";
import { listSuppressions } from "@/server/modules/crm/suppression";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.prospecting") };
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "info" | "danger"> = { ACTIVE: "success", PAUSED: "warning", DRAFT: "neutral" };
const REPLY_TONE: Record<string, "success" | "warning" | "neutral" | "info" | "danger" | "accent"> = {
  INTERESTED: "success",
  QUESTION: "info",
  REFERRAL: "accent",
  OUT_OF_OFFICE: "neutral",
  NOT_INTERESTED: "warning",
  UNSUBSCRIBE: "danger",
  OTHER: "neutral",
};
const PERSON_TONE: Record<string, "success" | "warning" | "neutral" | "info" | "danger" | "accent"> = {
  FOUND: "neutral",
  READY: "info",
  SKIPPED: "neutral",
  CONTACTED: "accent",
  REPLIED: "success",
  MEETING: "success",
  BOUNCED: "danger",
  UNSUBSCRIBED: "warning",
  STOPPED: "warning",
};

/** Prospecting autopilot (AI SDR): plain-language setup, honest live funnel, provider status and the do-not-contact list. */
export default async function ProspectingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="prospecting">{null}</CrmFrame>;
  const { t, locale, tz, org, company, viewer, base } = c;
  const q = await searchParams;
  const [channels, providers, autopilots, funnel, dnc] = await Promise.all([
    revenueChannels(org.id, company.id),
    contactProviderStatus(org.id, company.id),
    listAutopilots(viewer.ctx, org.id, company.id),
    companyFunnel(viewer.ctx, org.id, company.id),
    listSuppressions(viewer.ctx, org.id, company.id, { take: 200 }),
  ]);
  const wanted = param(q, "autopilot");
  const selectedId = autopilots.find((a) => a.id === wanted)?.id ?? autopilots[0]?.id ?? null;
  const selected = selectedId ? await getAutopilot(viewer.ctx, org.id, company.id, selectedId) : null;
  const hasContacts = channels.contacts.length > 0;
  const cost = (micros: number | null) => (micros == null ? null : formatMoney({ amountMinor: BigInt(Math.round(micros / 10_000)), currency: "USD" }, locale));
  const providerRows = providers.map((p) => ({ provider: p.provider, name: providerInfo(p.provider)?.name ?? p.provider, connected: p.connected, status: p.status, account: p.account, lastError: p.lastError, calls30d: p.calls30d, failed30d: p.failed30d, cost: cost(p.costMicros30d) }));
  const noteText = (n: { code: string; detail?: string }) => `${t(`crm.prospecting.notes.${n.code}`)}${n.detail ? ` (${n.detail})` : ""}`;

  return (
    <CrmFrame
      active="prospecting"
      eyebrow={t("crm.prospecting.eyebrow")}
      title={t("crm.prospecting.title")}
      subtitle={t("crm.prospecting.subtitle")}
      actions={c.canManage && autopilots.length ? <NewAutopilot base={base} locale={locale} hasContactProvider={hasContacts} startOpen={false} /> : undefined}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-4">
          {!hasContacts ? <ConnectNotice locale={locale} text={t("crm.prospecting.noProvider")} connect={t("crm.rev.connect")} /> : null}
          {!autopilots.length ? (
            c.canManage ? (
              <NewAutopilot base={base} locale={locale} hasContactProvider={hasContacts} startOpen />
            ) : (
              <Notice tone="info">{t("crm.prospecting.emptyReadOnly")}</Notice>
            )
          ) : null}

          <section className="grid gap-3 rounded-xl border bg-surface p-4 shadow-elev-1 sm:p-5" aria-labelledby="funnel-h">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="funnel-h" className="font-display text-2xl">
                {t("crm.prospecting.funnel.title")}
              </h2>
              <span className="text-xs text-muted-foreground">{t("crm.prospecting.funnel.scope", { count: autopilots.length })}</span>
            </div>
            <ProspectingFunnel counts={funnel} t={t} caption={t("crm.prospecting.funnel.caption", { companies: funnel.companies, skipped: funnel.skipped, bounced: funnel.bounced, unsubscribed: funnel.unsubscribed })} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Figure label={t("crm.prospecting.figures.awaiting")} value={funnel.awaitingApproval} caption={t("crm.prospecting.figures.awaitingHint")} href={`/${locale}/crm/outreach`} tone={funnel.awaitingApproval ? "warning" : undefined} />
              <Figure label={t("crm.prospecting.figures.drafts")} value={funnel.drafts} href={`/${locale}/crm/outreach`} />
              <Figure label={t("crm.prospecting.figures.sentToday")} value={funnel.sentToday} caption={t("crm.prospecting.figures.sentTodayHint")} />
            </div>
          </section>

          {autopilots.length ? (
            <section className="grid gap-3" aria-labelledby="ap-list-h">
              <h2 id="ap-list-h" className="flex items-center gap-2 font-display text-xl">
                <Bot className="size-4 text-primary" aria-hidden />
                {t("crm.prospecting.list")}
              </h2>
              <ul className="grid gap-2 md:grid-cols-2">
                {autopilots.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/${locale}/crm/prospecting?autopilot=${a.id}`}
                      aria-current={a.id === selectedId ? "page" : undefined}
                      className={cn("grid gap-1.5 rounded-xl border bg-surface p-3 shadow-elev-1 transition-shadow hover:shadow-elev-2", a.id === selectedId ? "border-primary/50" : "")}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                        <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{t(`crm.prospecting.status.${a.status}`)}</Badge>
                      </span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">{a.audience}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{t("crm.prospecting.cardFunnel", { found: a.funnel.found, verified: a.funnel.verified, contacted: a.funnel.contacted, replied: a.funnel.replied, meetings: a.funnel.meetings })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {selected ? (
            <section className="grid gap-4 rounded-xl border bg-surface p-4 shadow-elev-1 sm:p-5" aria-labelledby="ap-detail-h">
              <header className="flex flex-wrap items-start gap-3">
                <div className="grid min-w-0 flex-1 gap-1">
                  <h2 id="ap-detail-h" className="font-display text-2xl">
                    {selected.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">{selected.audience}</p>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Badge tone={STATUS_TONE[selected.status] ?? "neutral"}>{t(`crm.prospecting.status.${selected.status}`)}</Badge>
                    <Badge tone="accent">{t(`crm.prospecting.autonomy.${selected.effective.level}`)}</Badge>
                    <Badge>{t("crm.prospecting.capsBadge", { quota: selected.dailyQuota, cap: selected.dailySendCap })}</Badge>
                    {selected.allowUnverified ? <Badge tone="warning">{t("crm.prospecting.unverifiedBadge", { cap: selected.unverifiedDailyCap })}</Badge> : <Badge tone="success">{t("crm.prospecting.verifiedOnly")}</Badge>}
                    <Badge>{t(`crm.prospecting.consent.${selected.consentBasis}`)}</Badge>
                  </div>
                </div>
                {c.canManage ? (
                  <div className="grid gap-2">
                    <AutopilotControls base={base} id={selected.id} status={selected.status} autonomy={selected.autonomy} dailySendCap={selected.dailySendCap} />
                    <EditAutopilot
                      base={base}
                      locale={locale}
                      id={selected.id}
                      hasContactProvider={hasContacts}
                      initial={{
                        name: selected.name,
                        audience: selected.audience,
                        pitch: selected.pitch,
                        regions: selected.regions,
                        roles: selected.roles,
                        seniorities: selected.seniorities,
                        exclusions: selected.exclusions,
                        targetDomains: selected.targetDomains,
                        dailyQuota: selected.dailyQuota,
                        dailySendCap: selected.dailySendCap,
                        peoplePerCompany: selected.peoplePerCompany,
                        autonomy: selected.autonomy,
                        allowUnverified: selected.allowUnverified,
                        unverifiedDailyCap: selected.unverifiedDailyCap || 3,
                        consentBasis: selected.consentBasis as "legitimate_interest",
                        consentNote: selected.consentNote,
                        firstSubject: selected.firstSubject,
                        firstBody: selected.firstBody,
                        unsubscribeLine: selected.unsubscribeLine,
                        followUps: (selected.cadence?.steps ?? []).filter((s) => s.kind === "EMAIL").map((s) => ({ delayDays: s.delayDays, subject: s.subject, body: s.body })),
                      }}
                    />
                  </div>
                ) : null}
              </header>
              {selected.effective.limitedBy ? <Notice tone="info">{t(`crm.prospecting.limited.${selected.effective.limitedBy}`, { level: t(`crm.prospecting.autonomy.${selected.autonomy}`) })}</Notice> : null}
              {selected.lastError ? <Notice tone="warning">{t(`crm.prospecting.notes.${selected.lastError}`) === `crm.prospecting.notes.${selected.lastError}` ? selected.lastError : t(`crm.prospecting.notes.${selected.lastError}`)}</Notice> : null}
              <p className="text-xs text-muted-foreground">
                {selected.status === "ACTIVE"
                  ? t("crm.prospecting.schedule", { last: selected.lastRunAt ? formatDateTime(selected.lastRunAt, locale, tz) : "—", next: selected.nextRunAt ? formatDateTime(selected.nextRunAt, locale, tz) : "—" })
                  : t("crm.prospecting.off")}
              </p>
              <ProspectingFunnel counts={selected.funnel} t={t} />

              <div className="grid gap-2">
                <h3 className="flex items-center gap-2 font-display text-lg">
                  <Users className="size-4 text-primary" aria-hidden />
                  {t("crm.prospecting.people.title")}
                </h3>
                {selected.people.length ? (
                  <ul className="grid gap-2">
                    {selected.people.map((p) => (
                      <li key={p.id} className="grid gap-1 rounded-lg border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="grid min-w-0 gap-0.5">
                          <span className="flex flex-wrap items-center gap-2">
                            {p.leadId ? (
                              <Link href={`/${locale}/crm/${p.leadId}`} className="font-medium hover:underline">
                                {p.fullName}
                              </Link>
                            ) : (
                              <span className="font-medium">{p.fullName}</span>
                            )}
                            {p.linkedinUrl ? (
                              <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer nofollow" aria-label={t("crm.prospecting.people.linkedin", { name: p.fullName })} className="text-muted-foreground hover:text-foreground">
                                <ExternalLink className="size-3.5" aria-hidden />
                              </a>
                            ) : null}
                          </span>
                          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                            <Building2 className="size-3" aria-hidden />
                            {[p.title, p.companyName ?? p.domain].filter(Boolean).join(" · ")}
                          </span>
                          <span className="flex flex-wrap items-center gap-2 text-xs">
                            <EmailBadge status={p.emailStatus} email={p.email} />
                            <span className="text-muted-foreground">{t("crm.prospecting.people.source", { found: p.sourceProvider, email: p.emailSource ?? "—", checked: p.verifiedBy ?? "—" })}</span>
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                          <Badge tone={PERSON_TONE[p.status] ?? "neutral"}>{t(`crm.prospecting.personStatus.${p.status}`)}</Badge>
                          {p.replyClass ? (
                            <Badge tone={REPLY_TONE[p.replyClass] ?? "neutral"}>
                              {t(`crm.prospecting.replyClass.${p.replyClass}`)}
                              {p.replyClass === "OUT_OF_OFFICE" && p.replyResumeAt ? ` · ${formatDate(p.replyResumeAt, locale, tz)}` : ""}
                            </Badge>
                          ) : null}
                          {p.skipReason ? <span className="text-xs text-muted-foreground">{t(`crm.prospecting.skip.${p.skipReason}`) === `crm.prospecting.skip.${p.skipReason}` ? p.skipReason : t(`crm.prospecting.skip.${p.skipReason}`)}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{selected.status === "ACTIVE" ? t("crm.prospecting.people.emptyActive") : t("crm.prospecting.people.empty")}</p>
                )}
              </div>

              <div className="grid gap-2">
                <h3 className="flex items-center gap-2 font-display text-lg">
                  <History className="size-4 text-primary" aria-hidden />
                  {t("crm.prospecting.runs.title")}
                </h3>
                {selected.runs.length ? (
                  <ul className="grid gap-2 text-sm">
                    {selected.runs.map((r) => {
                      const notes = (Array.isArray(r.notes) ? r.notes : []) as { code: string; detail?: string }[];
                      return (
                        <li key={r.id} className="grid gap-1 rounded-lg border p-3">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{formatDateTime(r.startedAt, locale, tz)}</span>
                            <Badge tone={r.outcome === "ok" ? "success" : r.outcome === "failed" ? "danger" : "warning"}>{t(`crm.prospecting.runs.outcome.${r.outcome}`)}</Badge>
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">{t("crm.prospecting.runs.summary", { companies: r.companies, found: r.found, verified: r.verified, leads: r.leads, drafted: r.drafted, sent: r.sent, stopped: r.stopped })}</span>
                          {notes.length ? (
                            <ul className="grid gap-0.5 text-xs text-muted-foreground">
                              {notes.map((n, i) => (
                                <li key={i}>• {noteText(n)}</li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("crm.prospecting.runs.empty")}</p>
                )}
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Inbox className="size-3.5" aria-hidden />
                <Link href={`/${locale}/crm/outreach`} className="underline">
                  {t("crm.prospecting.toOutreach")}
                </Link>
                {selected.cadenceId ? (
                  <>
                    ·
                    <Link href={`/${locale}/crm/sequences/${selected.cadenceId}`} className="underline">
                      {t("crm.prospecting.toSequence")}
                    </Link>
                  </>
                ) : null}
              </p>
            </section>
          ) : null}
        </div>

        <aside className="grid content-start gap-4">
          <ProviderStatus rows={providerRows} extras={{ research: channels.research, aiText: channels.aiText, email: channels.mailbox?.address ?? (channels.sendgrid ? "SendGrid" : null) }} locale={locale} t={t} />
          <SuppressionManager
            base={base}
            canManage={c.canManage}
            total={dnc.total}
            marketingUnsubscribes={dnc.marketingUnsubscribes}
            rows={dnc.rows.map((r) => ({ id: r.id, kind: r.kind, value: r.value, reason: r.reason, source: r.source, when: formatDateTime(r.createdAt, locale, tz) }))}
          />
          <section className="grid gap-2 rounded-xl border bg-surface p-4 text-xs text-muted-foreground shadow-elev-1">
            <h2 className="font-display text-base text-foreground">{t("crm.prospecting.rules.title")}</h2>
            <ul className="grid list-disc gap-1 ps-4">
              {(["verified", "unsubscribe", "stop", "caps", "consent"] as const).map((k) => (
                <li key={k}>{t(`crm.prospecting.rules.${k}`)}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </CrmFrame>
  );
}
