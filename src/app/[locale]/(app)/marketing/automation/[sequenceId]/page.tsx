import type { Metadata } from "next";
import { emailDeliveryReady } from "@/server/modules/marketing/email";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { EnrollForm, SequenceForm, StepForm } from "@/components/marketing/sequence-forms";
import { Kpi, MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { listForms } from "@/server/modules/marketing/forms";
import { listSegments } from "@/server/modules/marketing/segments";
import { ENROLLMENT_STATUSES, getSequence } from "@/server/modules/marketing/sequences";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.automation") };
}

export default async function SequencePage({ params, searchParams }: PageProps<"/[locale]/marketing/automation/[sequenceId]">) {
  const { sequenceId } = await params;
  const st = (await searchParams).status;
  const status = typeof st === "string" ? st : undefined;
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/automation`, label: t("marketing.automation.title") };
  if (m.blocked) return <MarketingShell locale={locale} t={t} tab="automation" title={t("marketing.automation.title")} back={back} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const d = await getSequence(viewer.ctx, org.id, company.id, sequenceId, status).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const s = d.sequence;
  const manage = canManage && !s.archivedAt;
  const [forms, segments] = manage ? await Promise.all([listForms(viewer.ctx, org.id, company.id), listSegments(viewer.ctx, org.id, company.id)]) : [[], []];
  const sentFor = (stepId: string, k: string) => d.sends.filter((x) => x.stepId === stepId && x.status === k).reduce((n, x) => n + x._count._all, 0);
  const path = `/${locale}/marketing/automation/${s.id}`;
  const cumulativeHours = s.steps.map((_, i) => s.steps.slice(0, i + 1).reduce((n, x) => n + x.delayHours, 0));

  return (
    <MarketingShell
      locale={locale}
      t={t}
      tab="automation"
      back={back}
      title={s.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={s.status} label={t(`marketing.automation.status.${s.status}`)} />
          <span className="text-xs">
            {t(`marketing.automation.triggers.${s.trigger}`)}
            {s.triggerForm ? ` · ${s.triggerForm.name}` : ""}
          </span>
        </span>
      }
      actions={
        manage ? (
          <>
            <ActionButton path={`${base}/sequences/${s.id}`} method="PATCH" body={{ status: s.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }} variant={s.status === "ACTIVE" ? "secondary" : "default"} label={s.status === "ACTIVE" ? t("marketing.automation.pause") : t("marketing.automation.activate")} />
            <ActionButton path={`${base}/sequences/${s.id}`} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} redirectTo={back.href} />
          </>
        ) : null
      }
    >
      {!(await emailDeliveryReady(org.id, company.id)) ? <Notice tone="warning">{t("marketing.automation.emailNotConfigured")}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        {ENROLLMENT_STATUSES.map((k) => (
          <Kpi key={k} label={t(`marketing.automation.enrollmentStatus.${k}`)} value={d.counts[k] ?? 0} />
        ))}
      </div>
      <Card>
        <CardHeader title={t("marketing.automation.steps")} description={t("marketing.automation.stepsHint")} />
        {s.steps.length === 0 ? <p className="p-4 text-muted-foreground">{t("marketing.automation.noSteps")}</p> : null}
        <ol className="grid divide-y">
          {s.steps.map((step, i) => {
            const cumulative = cumulativeHours[i];
            return (
              <li key={step.id} className="grid gap-1">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2 text-sm">
                    <span className="font-medium">{t("marketing.automation.stepN", { n: i + 1 })}</span>
                    <span className="text-xs text-muted-foreground">{t("marketing.automation.afterHours", { hours: step.delayHours, total: cumulative })}</span>
                    <span className="min-w-0 flex-1 truncate">{step.subject}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("marketing.automation.stepStats", { sent: sentFor(step.id, "SENT"), failed: sentFor(step.id, "FAILED") + sentFor(step.id, "NOT_CONFIGURED") })}
                    </span>
                  </summary>
                  {manage ? (
                    <>
                      <StepForm base={base} sequenceId={s.id} initial={{ id: step.id, delayHours: step.delayHours, subject: step.subject, body: step.body }} />
                      <div className="px-4 pb-3">
                        <ActionButton path={`${base}/sequences/${s.id}/steps/${step.id}`} method="DELETE" variant="ghost" icon={<Trash2 aria-hidden />} label={t("marketing.common.delete")} confirm={t("marketing.common.confirmDelete")} />
                      </div>
                    </>
                  ) : (
                    <pre className="whitespace-pre-wrap px-4 pb-3 font-sans text-xs">{step.body}</pre>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
        {manage ? (
          <details className="border-t">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.automation.addStep")}</summary>
            <StepForm base={base} sequenceId={s.id} />
          </details>
        ) : null}
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("marketing.automation.enrollments")} />
          <div className="flex flex-wrap gap-2 border-b p-3 text-xs">
            <Link href={path} className={`rounded-md border px-2 py-1 ${!status ? "bg-muted" : ""}`}>
              {t("common.all")}
            </Link>
            {ENROLLMENT_STATUSES.map((k) => (
              <Link key={k} href={`${path}?status=${k}`} className={`rounded-md border px-2 py-1 ${status === k ? "bg-muted" : ""}`}>
                {t(`marketing.automation.enrollmentStatus.${k}`)}
              </Link>
            ))}
          </div>
          {d.enrollments.length === 0 ? (
            <p className="p-4 text-muted-foreground">{t("marketing.automation.noEnrollments")}</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("marketing.email.recipient")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th>{t("marketing.automation.progress")}</Th>
                  <Th>{t("marketing.automation.nextSend")}</Th>
                  {manage ? <Th className="w-0" /> : null}
                </Tr>
              </THead>
              <TBody>
                {d.enrollments.map((e) => (
                  <Tr key={e.id}>
                    <Td>
                      <p>{e.email}</p>
                      {e.leadId ? (
                        <Link href={`/${locale}/crm/${e.leadId}`} className="text-xs text-muted-foreground hover:underline">
                          {t("marketing.forms.openLead")}
                        </Link>
                      ) : null}
                    </Td>
                    <Td>
                      <StatusBadge status={e.status === "COMPLETED" ? "SENT" : e.status} label={t(`marketing.automation.enrollmentStatus.${e.status}`)} />
                    </Td>
                    <Td className="text-xs tabular-nums">
                      {Math.min(e.nextStep, s.steps.length)} / {s.steps.length}
                    </Td>
                    <Td className="text-xs text-muted-foreground">{e.status === "ACTIVE" && e.nextRunAt ? formatDateTime(e.nextRunAt, locale, tz) : "—"}</Td>
                    {manage ? (
                      <Td>{e.status === "ACTIVE" ? <ActionButton path={`${base}/sequences/${s.id}/enrollments/${e.id}`} method="DELETE" variant="ghost" label={t("marketing.automation.stop")} /> : null}</Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <div className="grid content-start gap-4">
          {manage ? (
            <Card>
              <CardHeader title={t("marketing.automation.enrollSegment")} description={t("marketing.automation.enrollHint")} />
              <EnrollForm base={base} sequenceId={s.id} segments={segments.map((x) => ({ id: x.id, name: x.name }))} />
            </Card>
          ) : null}
          {manage ? (
            <Card>
              <details>
                <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.automation.edit")}</summary>
                <SequenceForm base={base} locale={locale} forms={forms.map((f) => ({ id: f.id, name: f.name }))} initial={{ id: s.id, name: s.name, description: s.description ?? "", trigger: s.trigger, triggerFormId: s.triggerFormId ?? "" }} />
              </details>
            </Card>
          ) : null}
        </div>
      </div>
    </MarketingShell>
  );
}
