import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, ExternalLink, Gauge, ListChecks, Mail, Radar, Repeat, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { formatDateTime, formatMoney } from "@/i18n/format";
import { revenueChannels, type RevenueChannels } from "@/server/modules/crm/channels";
import { enrollmentsFor, listCadences } from "@/server/modules/crm/cadences";
import { latestIntel } from "@/server/modules/crm/intel";
import { listCrmMeetings } from "@/server/modules/crm/meetings";
import { nextActions, type NbaSubject } from "@/server/modules/crm/next-actions";
import { listOutreach } from "@/server/modules/crm/outreach";
import { explainScore, type ScoreInput } from "@/server/modules/crm/scoring";
import { cn } from "@/lib/utils";
import { crmContext } from "../shell";
import { IntelButton } from "./intel-buttons";
import { MeetingActions, MeetingScheduler } from "./meetings";
import { ActionRow, type SubjectView } from "./next-actions";
import { OutreachCard, OutreachComposer, type OutreachView, type RecipientRef } from "./outreach";
import { EnrollOne, StopEnrollmentButton } from "./sequences";

/** Server building blocks of the revenue engine on record pages (lead, contact, deal, account) and list pages. */

type Ctx = Awaited<ReturnType<typeof crmContext>> & { company: NonNullable<Awaited<ReturnType<typeof crmContext>>["company"]> };

export function Panel({ id, icon, title, description, children, className, action }: { id?: string; icon: ReactNode; title: ReactNode; description?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section id={id} className={cn("grid scroll-mt-24 content-start gap-3 rounded-xl border bg-surface p-4 shadow-elev-1", className)}>
      <header className="flex flex-wrap items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-4">
          {icon}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="font-display text-lg leading-tight">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function ConnectNotice({ locale, text, connect }: { locale: string; text: string; connect: string }) {
  return (
    <Notice tone="warning">
      {text}{" "}
      <Link href={`/${locale}/integrations`} className="font-medium underline">
        {connect}
      </Link>
    </Notice>
  );
}

export const canSendWith = (ch: RevenueChannels) => !!ch.mailbox || ch.sendgrid;

export function toSubjectView(s: NbaSubject, locale: string): SubjectView {
  return { type: s.type, id: s.id, name: s.name, href: s.href, value: s.valueMinor != null && s.valueMinor > 0n ? formatMoney({ amountMinor: s.valueMinor, currency: s.currency }, locale) : null, meta: s.meta, actions: s.actions };
}

export function toOutreachView(m: Awaited<ReturnType<typeof listOutreach>>[number], locale: string, tz: string): OutreachView {
  return {
    id: m.id,
    toEmail: m.toEmail,
    toName: m.toName,
    subject: m.subject,
    body: m.body,
    status: m.status,
    channel: m.channel,
    error: m.error,
    aiProvider: m.aiProvider,
    sequence: m.enrollment?.cadence ?? null,
    step: m.stepPosition,
    when: formatDateTime(m.sentAt ?? m.updatedAt, locale, tz),
    recordHref: m.leadId ? `/crm/${m.leadId}` : m.dealId ? `/crm/deals/${m.dealId}` : m.contactId ? `/crm/contacts/${m.contactId}` : null,
  };
}

/** "Why this score": the same arithmetic as the score, item by item. */
export async function ScoreWhy({ lead }: { lead: ScoreInput }) {
  const c = await crmContext();
  const { t } = c;
  const e = explainScore(lead);
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-4xl tabular-nums">{e.score}</span>
        <span className="text-sm text-muted-foreground">/ 100 · {t(`crm.scoreLabels.${e.label}`)}</span>
      </div>
      <ul className="grid gap-1.5">
        {e.factors.map((f) => (
          <li key={f.key} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{t(`crm.rev.score.${f.key}`)}</span>
              <span className={cn("tabular-nums", f.points < 0 ? "text-danger" : f.points === 0 ? "text-muted-foreground" : "")}>
                {f.points > 0 ? "+" : ""}
                {f.points}
                {f.max > 0 ? <span className="text-muted-foreground"> / {f.max}</span> : null}
              </span>
            </div>
            {f.max > 0 ? (
              <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-[linear-gradient(90deg,var(--primary),var(--primary-2))]" style={{ width: `${Math.max(0, (f.points / f.max) * 100)}%` }} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("crm.rev.score.note")}</p>
    </div>
  );
}

function FitRing({ fit }: { fit: number }) {
  const r = 26;
  const len = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0" role="img" aria-label={`${fit}/100`}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(fit / 100) * len} ${len}`} transform="rotate(-90 32 32)" />
      <text x="32" y="37" textAnchor="middle" className="fill-foreground text-[15px] font-semibold tabular-nums">
        {fit}
      </text>
    </svg>
  );
}

/** Enrichment (web sources) + AI qualification for a lead, or enrichment for an account. */
export async function IntelPanel({ leadId, accountId, channels, score }: { leadId?: string; accountId?: string; channels: RevenueChannels; score?: ScoreInput }) {
  const c = (await crmContext()) as Ctx;
  const { t, locale, tz, base } = c;
  const intel = await latestIntel(c.viewer.ctx, c.org.id, c.company.id, leadId ? { leadId } : { accountId });
  const e = intel.enrichment;
  const q = intel.qualification;
  const enrichUrl = leadId ? `${base}/crm/intel/leads/${leadId}/enrich` : `${base}/crm/intel/accounts/${accountId}/enrich`;
  return (
    <div className={cn("grid gap-4", leadId ? "lg:grid-cols-3" : "")}>
      {leadId && score ? (
        <Panel icon={<Gauge />} title={t("crm.rev.score.title")} description={t("crm.rev.score.description")}>
          <ScoreWhy lead={score} />
        </Panel>
      ) : null}
      {leadId ? (
        <Panel icon={<Sparkles />} title={t("crm.rev.intel.qualTitle")} description={t("crm.rev.intel.qualDescription")} action={c.canManage && channels.aiText.length ? <IntelButton url={`${base}/crm/intel/leads/${leadId}/qualify`} kind="qualify" again={!!q} /> : null}>
          {!channels.aiText.length && !q ? <ConnectNotice locale={locale} text={t("crm.rev.intel.aiMissing")} connect={t("crm.rev.connect")} /> : null}
          {q ? (
            <div className="grid gap-3">
              <div className="flex items-center gap-3">
                <FitRing fit={q.fit} />
                <div className="grid gap-1">
                  <Badge tone={q.verdict === "qualified" ? "success" : q.verdict === "disqualify" ? "danger" : q.verdict === "nurture" ? "warning" : "info"}>{t(`crm.rev.intel.verdicts.${q.verdict}`)}</Badge>
                  <p className="text-sm">{q.summary}</p>
                </div>
              </div>
              {q.reasons.length ? (
                <ul className="grid gap-1 text-sm">
                  {q.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className={r.positive ? "text-success" : "text-danger"}>
                        {r.positive ? "＋" : "－"}
                      </span>
                      {r.text}
                    </li>
                  ))}
                </ul>
              ) : null}
              {q.missing.length ? (
                <div className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">{t("crm.rev.intel.ask")}</p>
                  <ul className="grid list-disc gap-0.5 ps-5 text-sm">
                    {q.missing.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("crm.rev.intel.by", { provider: q.model ?? q.provider ?? "AI", date: formatDateTime(q.createdAt, locale, tz) })}</p>
              {c.canManage && Object.values(q.bant ?? {}).some(Boolean) ? <IntelButton url={`${base}/crm/intel/${q.id}/apply`} kind="apply" /> : null}
            </div>
          ) : channels.aiText.length ? (
            <p className="text-sm text-muted-foreground">{t("crm.rev.intel.qualEmpty")}</p>
          ) : null}
        </Panel>
      ) : null}
      <Panel icon={<Radar />} title={t("crm.rev.intel.enrichTitle")} description={t("crm.rev.intel.enrichDescription")} action={c.canManage && channels.research.length ? <IntelButton url={enrichUrl} kind="enrich" again={!!e} /> : null}>
        {!channels.research.length && !e ? <ConnectNotice locale={locale} text={t("crm.rev.intel.researchMissing")} connect={t("crm.rev.connect")} /> : null}
        {e ? (
          <div className="grid gap-3">
            {e.summary ? <p className="text-sm">{e.summary}</p> : null}
            {e.facts.length ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {e.facts.map((f, i) => (
                  <div key={i} className="grid gap-0.5">
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd>
                      {f.value}
                      {f.sourceUrl ? (
                        <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="ms-1 inline-flex align-middle text-muted-foreground hover:text-foreground" aria-label={t("crm.rev.intel.source")}>
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">{t(channels.aiText.length ? "crm.rev.intel.noFacts" : "crm.rev.intel.sourcesOnly")}</p>
            )}
            <details>
              <summary className="cursor-pointer text-sm">{t("crm.rev.intel.sources", { count: e.sources.length })}</summary>
              <ul className="mt-2 grid gap-2">
                {e.sources.map((s) => (
                  <li key={s.url} className="grid gap-0.5 text-sm">
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:underline">
                      {s.title || s.url}
                    </a>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{s.snippet}</span>
                  </li>
                ))}
              </ul>
            </details>
            <p className="text-xs text-muted-foreground">{t("crm.rev.intel.by", { provider: e.provider ?? "—", date: formatDateTime(e.createdAt, locale, tz) })}</p>
          </div>
        ) : channels.research.length ? (
          <p className="text-sm text-muted-foreground">{t("crm.rev.intel.enrichEmpty")}</p>
        ) : null}
      </Panel>
    </div>
  );
}

/** Next best actions for one lead or deal. */
export async function RecordNextActions({ leadId, dealId, channels }: { leadId?: string; dealId?: string; channels: RevenueChannels }) {
  const c = (await crmContext()) as Ctx;
  const subjects = await nextActions(c.viewer.ctx, c.org.id, c.company.id, leadId ? { leadId } : { dealId });
  const s = subjects[0];
  return (
    <Panel icon={<ListChecks />} title={c.t("crm.rev.nba.title")} description={c.t("crm.rev.nba.description")} className="border-primary/30 bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_7%,var(--surface)),var(--surface)_70%)]">
      {s ? (
        <div className="grid gap-3">
          {s.actions.slice(0, 3).map((a) => (
            <ActionRow key={a.kind} base={c.base} locale={c.locale} subject={{ type: s.type, id: s.id }} action={a} canManage={c.canManage} aiText={channels.aiText.length > 0} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{c.t("crm.rev.nba.none")}</p>
      )}
    </Panel>
  );
}

/** Personal emails for a record: composer + its drafts / approvals / sent emails. */
export async function RecordOutreach({ refs, channels, hasEmail }: { refs: RecipientRef; channels: RevenueChannels; hasEmail: boolean }) {
  const c = (await crmContext()) as Ctx;
  const { t, locale, tz, base } = c;
  const messages = await listOutreach(c.viewer.ctx, c.org.id, c.company.id, { ...refs, take: 10 });
  const canSend = c.canManage && canSendWith(channels);
  return (
    <Panel id="outreach" icon={<Mail />} title={t("crm.rev.outreach.recordTitle")} description={t("crm.rev.outreach.recordDescription")}>
      {!canSendWith(channels) ? <ConnectNotice locale={locale} text={t("crm.rev.outreach.noChannel")} connect={t("crm.rev.connect")} /> : null}
      {c.canManage ? hasEmail ? <OutreachComposer base={base} locale={locale} fixed={refs} aiText={channels.aiText.length > 0} canSend={canSend} /> : <p className="text-sm text-muted-foreground">{t("crm.rev.outreach.needEmail")}</p> : null}
      {messages.length ? (
        <div className="grid gap-3">
          {messages.map((m) => (
            <OutreachCard key={m.id} base={base} locale={locale} m={toOutreachView(m, locale, tz)} canManage={c.canManage} canSend={canSend} />
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

/** Meetings with this customer + booking form. */
export async function RecordMeetings({ refs, title, channels }: { refs: RecipientRef; title: string; channels: RevenueChannels }) {
  const c = (await crmContext()) as Ctx;
  const { t, locale, tz, base } = c;
  const meetings = await listCrmMeetings(c.viewer.ctx, c.org.id, c.company.id, { ...refs, take: 10 });
  return (
    <Panel icon={<CalendarClock />} title={t("crm.rev.meet.recordTitle")} description={t("crm.rev.meet.recordDescription")}>
      {meetings.length ? (
        <ul className="grid gap-3">
          {meetings.map((m) => (
            <li key={m.id} className="grid gap-1 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.title}</span>
                <Badge tone={m.status === "SCHEDULED" ? "accent" : m.status === "COMPLETED" ? "success" : "neutral"}>{t(`crm.rev.meet.status.${m.status}`)}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(m.startsAt, locale, tz)}
                {m.location ? ` · ${m.location}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {m.externalId ? t(m.inviteSentAt ? "crm.rev.meet.onCalendarGuest" : "crm.rev.meet.onCalendar", { email: m.attendeeEmail ?? "" }) : m.calendarError ? t("crm.rev.meet.calendarFailed") : t("crm.rev.meet.notOnCalendar")}
              </p>
              {m.outcome ? <p className="whitespace-pre-wrap text-sm">{m.outcome}</p> : null}
              <MeetingActions base={base} id={m.id} scheduled={m.status === "SCHEDULED"} canManage={c.canManage} retry={!m.externalId && !!channels.calendar} />
            </li>
          ))}
        </ul>
      ) : null}
      {c.canManage ? (
        <details open={!meetings.length}>
          <summary className="cursor-pointer text-sm font-medium">{t("crm.rev.meet.bookNew")}</summary>
          <div className="mt-3">
            <MeetingScheduler base={base} refs={refs} defaultTitle={title} calendar={channels.calendar} />
          </div>
        </details>
      ) : null}
    </Panel>
  );
}

/** Sequences this lead/contact is in + "start a sequence". */
export async function RecordSequences({ leadId, contactId, hasEmail }: { leadId?: string; contactId?: string; hasEmail: boolean }) {
  const c = (await crmContext()) as Ctx;
  const { t, locale, base } = c;
  const [mine, all] = await Promise.all([enrollmentsFor(c.viewer.ctx, c.org.id, c.company.id, leadId ? { leadId } : { contactId }), c.canManage ? listCadences(c.viewer.ctx, c.org.id, c.company.id) : Promise.resolve([])]);
  const available = all.filter((s) => s.status === "ACTIVE" && !mine.some((e) => e.cadenceId === s.id && (e.status === "ACTIVE" || e.status === "PAUSED"))).map((s) => ({ id: s.id, name: s.name }));
  return (
    <Panel icon={<Repeat />} title={t("crm.rev.seq.recordTitle")} description={t("crm.rev.seq.recordDescription")}>
      {mine.length ? (
        <ul className="grid gap-2">
          {mine.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/${locale}/crm/sequences/${e.cadence.id}`} className="font-medium hover:underline">
                {e.cadence.name}
              </Link>
              <Badge tone={e.status === "ACTIVE" ? "accent" : e.status === "REPLIED" ? "success" : e.status === "FAILED" ? "danger" : "neutral"}>{t(`crm.rev.seq.enrollStatus.${e.status}`)}</Badge>
              <span className="text-xs text-muted-foreground">{t("crm.rev.seq.progress", { done: Math.min(e.nextStep, e.cadence._count.steps), total: e.cadence._count.steps })}</span>
              {c.canManage && (e.status === "ACTIVE" || e.status === "PAUSED") ? <StopEnrollmentButton base={base} id={e.id} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {c.canManage ? (
        hasEmail ? (
          <EnrollOne base={base} sequences={available} leadId={leadId} contactId={contactId} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("crm.rev.outreach.needEmail")}</p>
        )
      ) : null}
      <Link href={`/${locale}/crm/sequences`} className="text-sm text-primary underline">
        {t("crm.rev.seq.manage")}
      </Link>
    </Panel>
  );
}

/** Everything the revenue engine offers on a record page, in one block. */
export async function RevenueWorkspace({ kind, id, name, hasEmail, score }: { kind: "lead" | "contact" | "deal"; id: string; name: string; hasEmail: boolean; score?: ScoreInput }) {
  const c = (await crmContext()) as Ctx;
  const channels = await revenueChannels(c.org.id, c.company.id);
  const refs: RecipientRef = kind === "lead" ? { leadId: id } : kind === "contact" ? { contactId: id } : { dealId: id };
  return (
    <div className="grid gap-4">
      {kind !== "contact" ? <RecordNextActions leadId={kind === "lead" ? id : undefined} dealId={kind === "deal" ? id : undefined} channels={channels} /> : null}
      {kind === "lead" ? <IntelPanel leadId={id} channels={channels} score={score} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <RecordOutreach refs={refs} channels={channels} hasEmail={hasEmail} />
        <div className="grid content-start gap-4">
          <RecordMeetings refs={refs} title={c.t("crm.rev.meet.defaultTitle", { name })} channels={channels} />
          {kind !== "deal" ? <RecordSequences leadId={kind === "lead" ? id : undefined} contactId={kind === "contact" ? id : undefined} hasEmail={hasEmail} /> : null}
        </div>
      </div>
    </div>
  );
}
