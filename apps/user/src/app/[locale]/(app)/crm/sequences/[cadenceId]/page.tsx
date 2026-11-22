import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { EnrollPicker, SequenceControls, SequenceEditor, StopEnrollmentButton, type PersonOption } from "@/components/crm/revenue/sequences";
import { canSendWith } from "@/components/crm/revenue/panels";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { getCadence } from "@/server/modules/crm/cadences";
import { revenueChannels } from "@/server/modules/crm/channels";
import { contactName } from "@/server/modules/crm/contacts";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.sequences") };
}

const ENROLL_TONE = { ACTIVE: "accent", PAUSED: "warning", COMPLETED: "success", REPLIED: "success", STOPPED: "neutral", FAILED: "danger" } as const;

export default async function SequencePage({ params }: { params: Promise<{ cadenceId: string }> }) {
  const { cadenceId } = await params;
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="sequences">{null}</CrmFrame>;
  const { t, locale, tz, org, company, viewer, base } = c;
  const s = await getCadence(viewer.ctx, org.id, company.id, cadenceId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  if (s.status === "ARCHIVED") notFound();
  const channels = await revenueChannels(org.id, company.id);
  const enrolled = new Set(s.enrollments.map((e) => e.toEmail));
  const [leads, contacts] = c.canManage
    ? await Promise.all([
        db().lead.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null, convertedAt: null, email: { not: null }, stage: { notIn: ["WON", "LOST"] } }, orderBy: { score: "desc" }, take: 300, select: { id: true, name: true, email: true, account: true } }),
        db().contact.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null, email: { not: null } }, orderBy: { updatedAt: "desc" }, take: 300, select: { id: true, firstName: true, lastName: true, email: true, account: { select: { name: true } } } }),
      ])
    : [[], []];
  const people: PersonOption[] = [
    ...leads.filter((l) => !enrolled.has(l.email!.toLowerCase())).map((l) => ({ id: l.id, type: "lead" as const, label: [l.name, l.account].filter(Boolean).join(" · ") })),
    ...contacts.filter((x) => !enrolled.has(x.email!.toLowerCase())).map((x) => ({ id: x.id, type: "contact" as const, label: [contactName(x), x.account?.name].filter(Boolean).join(" · ") })),
  ];
  return (
    <CrmFrame active="sequences" intro={false} eyebrow={t("crm.rev.seq.eyebrow")} title={s.name} subtitle={s.description ?? t("crm.rev.seq.subtitle")}>
      <Link href={`/${locale}/crm/sequences`} className="text-sm text-muted-foreground hover:underline">
        ← {t("crm.rev.seq.back")}
      </Link>
      <div className="flex flex-wrap gap-2">
        <Badge tone={s.status === "ACTIVE" ? "success" : s.status === "PAUSED" ? "warning" : "neutral"}>{t(`crm.rev.seq.status.${s.status}`)}</Badge>
        {s.status === "ACTIVE" ? <Badge tone={s.autoSend ? "info" : "neutral"}>{t(s.autoSend ? "crm.rev.seq.autoBadge" : "crm.rev.seq.reviewBadge")}</Badge> : null}
        {s.stopOnReply ? <Badge>{t("crm.rev.seq.stopsOnReply")}</Badge> : null}
      </div>
      {s.status !== "ACTIVE" ? <Notice tone="info">{t("crm.rev.seq.notRunning")}</Notice> : null}
      {s.stopOnReply && !channels.mailbox ? <Notice tone="warning">{t("crm.rev.seq.replyNeedsMailbox")}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-3 rounded-xl border bg-surface p-4 shadow-elev-1">
          <h2 className="font-display text-xl">{t("crm.rev.seq.steps")}</h2>
          {c.canManage ? (
            <SequenceEditor base={base} locale={locale} id={s.id} initial={{ name: s.name, description: s.description ?? "", stopOnReply: s.stopOnReply, steps: s.steps.map((x) => ({ kind: x.kind, delayDays: x.delayDays, subject: x.subject, body: x.body })) }} />
          ) : (
            <ol className="grid gap-2">
              {s.steps.map((x) => (
                <li key={x.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    {t(`crm.rev.seq.kinds.${x.kind}`)} · {t("crm.rev.seq.waitDays", { count: x.delayDays })}
                  </p>
                  {x.subject ? <p>{x.subject}</p> : null}
                  <p className="whitespace-pre-wrap text-muted-foreground">{x.body}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
        <div className="grid content-start gap-4">
          {c.canManage ? (
            <section className="grid gap-3 rounded-xl border bg-surface p-4 shadow-elev-1">
              <h2 className="font-display text-xl">{t("crm.rev.seq.run")}</h2>
              <SequenceControls base={base} locale={locale} id={s.id} status={s.status} canSend={canSendWith(channels)} />
            </section>
          ) : null}
          {c.canManage ? (
            <section className="grid gap-3 rounded-xl border bg-surface p-4 shadow-elev-1">
              <h2 className="font-display text-xl">{t("crm.rev.seq.addPeople")}</h2>
              <EnrollPicker base={base} id={s.id} people={people} />
            </section>
          ) : null}
          <section className="grid gap-3 rounded-xl border bg-surface p-4 shadow-elev-1">
            <h2 className="font-display text-xl">{t("crm.rev.seq.people", { count: s.enrollments.length })}</h2>
            {s.enrollments.length ? (
              <ul className="grid gap-2">
                {s.enrollments.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/${locale}${e.leadId ? `/crm/${e.leadId}` : `/crm/contacts/${e.contactId}`}`} className="font-medium hover:underline">
                      {e.name}
                    </Link>
                    <Badge tone={ENROLL_TONE[e.status]}>{t(`crm.rev.seq.enrollStatus.${e.status}`)}</Badge>
                    {e.replyClass ? <Badge tone="neutral">{t(`crm.prospecting.replyClass.${e.replyClass}`)}</Badge> : null}
                    {e.status === "PAUSED" && e.replyResumeAt ? <span className="text-xs text-muted-foreground">{t("crm.prospecting.replyResumes", { date: formatDateTime(e.replyResumeAt, locale, tz) })}</span> : null}
                    <span className="text-xs text-muted-foreground">
                      {t("crm.rev.seq.progress", { done: Math.min(e.nextStep, s.steps.length), total: s.steps.length })}
                      {e.status === "ACTIVE" ? (e.nextRunAt ? ` · ${t("crm.rev.seq.nextAt", { date: formatDateTime(e.nextRunAt, locale, tz) })}` : ` · ${t("crm.rev.seq.waitingApproval")}`) : ""}
                    </span>
                    {e.status === "FAILED" && e.stoppedReason ? <span className="w-full text-xs text-danger">{e.stoppedReason}</span> : null}
                    {c.canManage && (e.status === "ACTIVE" || e.status === "PAUSED") ? <StopEnrollmentButton base={base} id={e.id} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("crm.rev.seq.nobody")}</p>
            )}
          </section>
        </div>
      </div>
    </CrmFrame>
  );
}
