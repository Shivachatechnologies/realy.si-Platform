import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, BookOpen, Bot, Sparkles, Target } from "lucide-react";
import { ApiButton } from "@/components/command/api-button";
import { LiveRefresh } from "@/components/command/live-refresh";
import { AddInitiativeForm, InitiativeStatusSelect, OwnerSelect } from "@/components/objectives/execution-controls";
import { KrStatusBadge, ProgressBar } from "@/components/objectives/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber, formatRelativeTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { objectiveExecution, type ObjectiveExecutionView } from "@/server/modules/objectives/execution";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("objectives.execution.title") };
}

const OPEN = new Set(["PLANNED", "RUNNING", "REVIEWING"]);
const runTone = (s: string) => (s === "COMPLETED" ? "success" : s === "FAILED" ? "danger" : s === "CANCELLED" ? "neutral" : "info") as "success" | "danger" | "neutral" | "info";
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** One objective's execution: owner AI employee, live key results, initiatives and the AI work carrying them. */
export default async function ObjectiveExecutionPage({ params }: PageProps<"/[locale]/objectives/[objectiveId]">) {
  const { objectiveId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const back = (
    <Link href={`/${locale}/objectives`} className="hover:underline">
      {t("modules.objectives.title")}
    </Link>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1100px] gap-6">
        <PageHeader variant="editorial" world="projects" eyebrow={back} title={t("objectives.execution.title")} />
        <Card className="p-6 text-sm text-muted-foreground">{t("company.empty")}</Card>
      </div>
    );
  }
  let data: ObjectiveExecutionView;
  try {
    data = await objectiveExecution(viewer.ctx, org.id, company.id, objectiveId);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") notFound();
    if (isAppError(err) && err.code === "forbidden") {
      return (
        <div className="mx-auto grid max-w-[1100px] gap-6">
          <PageHeader variant="editorial" world="projects" eyebrow={back} title={t("objectives.execution.title")} />
          <Notice tone="warning">{t("errors.forbidden")}</Notice>
        </div>
      );
    }
    throw err;
  }
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const o = data.objective;
  const planning = data.planTask && (data.planTask.status === "QUEUED" || data.planTask.status === "RUNNING");
  const live = !!planning || data.initiatives.some((i) => i.run && OPEN.has(i.run.status));
  const value = (k: ObjectiveExecutionView["keyResults"][number], v: number | null) => {
    if (v === null) return "—";
    if (k.metricUnit === "money") return formatMoney({ amountMinor: BigInt(Math.round(v * 100)), currency: data.currency }, locale);
    if (k.metricUnit === "percent") return `${formatNumber(v, locale, { maximumFractionDigits: 1 })}%`;
    return `${formatNumber(v, locale, { maximumFractionDigits: 2 })}${k.unit ? ` ${k.unit}` : ""}`;
  };
  const roleOf = (profile: string) => t(`profiles.${profile}.name`);
  const aiReady = data.canReadAi && data.canRun;

  return (
    <div className="mx-auto grid max-w-[1100px] gap-6">
      <LiveRefresh active={live} />
      <PageHeader
        variant="editorial"
        world="projects"
        eyebrow={back}
        title={o.title}
        description={o.description ?? t("objectives.execution.subtitle")}
        actions={data.status ? <KrStatusBadge status={data.status} label={t(`objectives.kr.status.${data.status}`)} /> : null}
      />

      {data.status === "OFF_TRACK" ? (
        <Notice tone="danger" title={t("objectives.execution.offTrackTitle")}>
          {data.execution?.replannedAt ? t("objectives.execution.replanned", { when: formatRelativeTime(data.execution.replannedAt, locale) }) : t("objectives.execution.offTrackBody")}
        </Notice>
      ) : null}

      <Card>
        <CardHeader icon={<Target />} title={t("objectives.execution.progressTitle")} description={o.targetDate ? t("objectives.target", { date: formatDate(o.targetDate, locale, "UTC") }) : t("objectives.execution.noTarget")} />
        <CardBody className="grid gap-4">
          <div className="grid gap-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("objectives.overallProgress")}</span>
              <span className="tabular">{pct(data.progress)}</span>
            </div>
            <ProgressBar value={data.progress} status={data.status ?? "ON_TRACK"} label={t("objectives.overallProgress")} />
          </div>
          {data.keyResults.length ? (
            <ul className="grid gap-3">
              {data.keyResults.map((k) => (
                <li key={k.id} className="grid gap-1.5 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{k.title}</span>
                    <KrStatusBadge status={k.status} label={t(`objectives.kr.status.${k.status}`)} />
                  </div>
                  <ProgressBar value={k.progress} status={k.status} label={k.title} />
                  <p className="text-xs text-muted-foreground">{k.visible ? t("objectives.execution.krValue", { value: value(k, k.value), target: value(k, k.target) }) : t("objectives.execution.krHidden", { progress: pct(k.progress) })}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("objectives.execution.noKrs")}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<Bot />}
          title={t("objectives.execution.ownerTitle")}
          description={data.owner ? t("objectives.execution.ownerIs", { name: data.owner.name, role: roleOf(data.owner.profileKey) }) : t("objectives.execution.ownerNone")}
          actions={
            data.canManage && data.canReadAi ? (
              <OwnerSelect base={base} objectiveId={o.id} value={data.owner?.id ?? null} employees={data.employees.map((e) => ({ id: e.id, name: e.name, role: roleOf(e.profileKey) }))} />
            ) : null
          }
        />
        <CardBody className="grid gap-3">
          {data.canReadAi && !data.employees.length ? (
            <p className="text-sm text-muted-foreground">
              {t("objectives.execution.noEmployees")}{" "}
              <Link href={`/${locale}/workforce`} className="font-medium text-primary hover:underline">
                {t("objectives.execution.hire")}
              </Link>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {aiReady ? (
              <ApiButton path={`${base}/objectives/${o.id}/plan-initiatives`} variant="default">
                <Sparkles aria-hidden />
                {t(data.initiatives.length ? "objectives.execution.replan" : "objectives.execution.plan")}
              </ApiButton>
            ) : null}
            {data.planTask ? (
              <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge tone={data.planTask.status === "COMPLETED" ? "success" : data.planTask.status === "FAILED" ? "danger" : "info"} pulse={!!planning}>
                  {t(`guide.task.status.${data.planTask.status}`)}
                </Badge>
                {planning ? t("objectives.execution.planning") : data.planTask.status === "FAILED" ? (data.planTask.errorMessage ?? t("guide.task.failed")) : null}
                <Link href={`/${locale}/tasks/${data.planTask.id}`} className="font-medium text-primary hover:underline">
                  {t("guide.task.open")}
                </Link>
              </span>
            ) : null}
          </div>
          {!aiReady && data.canReadAi ? <p className="text-xs text-muted-foreground">{t("objectives.execution.cannotRun")}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<Sparkles />}
          title={t("objectives.execution.initiativesTitle")}
          description={t("objectives.execution.initiativesHint")}
          actions={data.canManage ? <AddInitiativeForm base={base} objectiveId={o.id} keyResults={data.keyResults.map((k) => ({ id: k.id, title: k.title }))} /> : null}
        />
        <CardBody>
          {data.initiatives.length ? (
            <ol className="grid gap-3">
              {data.initiatives.map((i) => {
                const kr = i.keyResultId ? data.keyResults.find((k) => k.id === i.keyResultId) : undefined;
                const closed = i.status === "DONE" || i.status === "DROPPED";
                return (
                  <li key={i.id} className={`grid gap-2 rounded-xl border bg-surface p-3 ${i.status === "DROPPED" ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{i.title}</p>
                        {i.description ? <p className="mt-0.5 text-xs text-muted-foreground">{i.description}</p> : null}
                        <p className="mt-1 flex flex-wrap gap-1.5">
                          <Badge>{t(`objectives.execution.source.${i.source === "ai" || i.source === "ceo" ? i.source : "manual"}`)}</Badge>
                          {kr ? <Badge tone="accent">{kr.title}</Badge> : null}
                        </p>
                      </div>
                      {data.canManage ? <InitiativeStatusSelect base={base} objectiveId={o.id} initiativeId={i.id} status={i.status} /> : <Badge>{t(`objectives.execution.initiativeStatus.${i.status}`)}</Badge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {i.run ? (
                        <>
                          <Badge tone={runTone(i.run.status)} pulse={OPEN.has(i.run.status)}>
                            {t(`command.ai.runStatus.${i.run.status}`)}
                          </Badge>
                          {i.run.sessionId ? (
                            <Link href={`/${locale}/command?s=${i.run.sessionId}`} className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
                              {t("objectives.execution.openRun")} <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
                            </Link>
                          ) : null}
                          {i.run.documentId ? (
                            <Link href={`/${locale}/brain/${i.run.documentId}`} className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
                              <BookOpen className="size-3" aria-hidden /> {t("objectives.execution.result")}
                            </Link>
                          ) : null}
                        </>
                      ) : null}
                      {aiReady && !closed && !(i.run && OPEN.has(i.run.status)) ? (
                        <ApiButton path={`${base}/objectives/${o.id}/initiatives/${i.id}/delegate`}>
                          <Bot aria-hidden />
                          {t(i.run ? "objectives.execution.delegateAgain" : "objectives.execution.delegate")}
                        </ApiButton>
                      ) : null}
                    </div>
                    {i.run?.nextAction ? (
                      <p className="text-xs">
                        <span className="font-semibold text-primary">{t("command.ai.nextAction")}: </span>
                        {i.run.nextAction}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t("objectives.execution.noInitiatives")}</p>
          )}
        </CardBody>
      </Card>

      {data.runs.length ? (
        <Card>
          <CardHeader title={t("objectives.execution.runsTitle")} description={t("objectives.execution.runsHint")} />
          <CardBody>
            <ul className="grid gap-2">
              {data.runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={runTone(r.status)}>{t(`command.ai.runStatus.${r.status}`)}</Badge>
                  {r.origin === "CEO" ? <Badge tone="accent">{t("command.ai.fromCeo")}</Badge> : null}
                  <span className="min-w-0 flex-1 truncate">{r.text}</span>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(r.createdAt, locale)}</span>
                  {r.sessionId ? (
                    <Link href={`/${locale}/command?s=${r.sessionId}`} className="text-xs font-medium text-primary hover:underline">
                      {t("objectives.execution.openRun")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
