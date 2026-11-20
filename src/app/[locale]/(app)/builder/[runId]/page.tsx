import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Building2, FileText, FolderKanban, Package, Target } from "lucide-react";
import { AddDocumentForm } from "@/components/brain/add-document-form";
import { DecisionCard } from "@/components/builder/decision-card";
import { BuilderFrame, RUN_TONE, STEP_TONE } from "@/components/builder/frame";
import { CancelRunButton, LiveRefresh, RetryStep, StartRunButton } from "@/components/builder/run-controls";
import { CsvImport as CrmCsvImport } from "@/components/crm/import-export";
import { CsvImport as HrCsvImport } from "@/components/hr/csv-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { getRunView } from "@/server/modules/builder/service";
import { CSV_HEADER } from "@/server/modules/hr/employees";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("builder.run.title") };
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const ACTIVE = ["DRAFT", "RUNNING", "WAITING_INPUT", "FAILED"];

/** Live builder workspace: real progress, the AI's current work, decisions, documents and what was created. */
export default async function BuilderRunPage({ params }: PageProps<"/[locale]/builder/[runId]">) {
  const { runId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company: activeCompany } = await requireOrgContext(locale);
  if (!isUuid(runId)) notFound();
  const row = await db().builderRun.findFirst({ where: { id: runId, organizationId: org.id }, select: { companyId: true } });
  if (!row) notFound();
  const chain = await companyChain(db(), org.id, row.companyId);
  const [canRead, canManage, canSeeTasks, canBrain, canSales, canHr] = await Promise.all([
    can(viewer.ctx, "companies.read", chain),
    can(viewer.ctx, "companies.manage", chain),
    can(viewer.ctx, "agents.read", chain),
    can(viewer.ctx, "brain.manage", chain),
    can(viewer.ctx, "sales.manage", chain),
    can(viewer.ctx, "hr.manage", chain),
  ]);
  if (!canRead) {
    return (
      <BuilderFrame locale={locale} active="run" title={t("builder.run.title")}>
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </BuilderFrame>
    );
  }
  const v = await getRunView(viewer.ctx, org.id, row.companyId, runId);
  const { run, steps } = v;
  const base = `/api/v1/organizations/${org.id}/companies/${run.companyId}/builder/runs/${run.id}`;
  const companyBase = `/api/v1/organizations/${org.id}/companies/${run.companyId}`;
  const done = steps.filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED").length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const current = steps.find((s) => s.status !== "COMPLETED" && s.status !== "SKIPPED") ?? null;
  const currentTask = current?.agentTaskId ? v.tasks.get(current.agentTaskId) : null;
  const openDecisions = v.decisions.filter((d) => d.status === "OPEN");
  const docs = steps.filter((s) => s.brainDocumentId && v.docs.has(s.brainDocumentId)).map((s) => ({ step: s.key, doc: v.docs.get(s.brainDocumentId!)! }));
  const brainCount = run.status === "DRAFT" ? await db().brainDocument.count({ where: { organizationId: org.id, companyId: run.companyId } }) : 0;
  const tz = viewer.user.timezone;
  const live = run.status === "RUNNING";

  return (
    <BuilderFrame
      locale={locale}
      active="run"
      title={run.company.name}
      description={t(`builder.modes.${run.mode}`)}
      meta={
        <>
          <Badge tone={RUN_TONE[run.status]} pulse={live}>
            {t(`builder.runStatus.${run.status}`)}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">{t("builder.list.steps", { done, total: steps.length })}</span>
        </>
      }
      actions={canManage && ACTIVE.includes(run.status) ? <CancelRunButton base={base} /> : null}
    >
      <LiveRefresh base={base} active={live} />
      {activeCompany?.id !== run.companyId ? <Notice tone="info">{t("builder.run.otherCompany", { name: run.company.name })}</Notice> : null}

      <Card>
        <CardBody className="grid gap-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">{t("builder.run.progress")}</span>
            <span className="tabular-nums text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={t("builder.run.progress")}>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          {current && run.status !== "DRAFT" && run.status !== "CANCELLED" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("builder.run.current")}</span>
              <span className="font-medium">{t(`builder.steps.${current.key}`)}</span>
              <Badge tone={STEP_TONE[current.status]} pulse={current.status === "RUNNING"}>
                {t(`builder.stepStatus.${current.status}`)}
              </Badge>
              {currentTask ? (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span>{t(`profiles.${currentTask.profile}.name`)}</span>
                  <Badge tone="neutral">{t(`agentTasks.status.${currentTask.status}`)}</Badge>
                  {currentTask.startedAt ? <span className="text-xs text-muted-foreground">{formatDateTime(currentTask.startedAt, locale, tz)}</span> : null}
                  {canSeeTasks ? (
                    <Link className="text-xs text-primary hover:underline" href={`/${locale}/tasks/${currentTask.id}`}>
                      {t("builder.run.openTask")}
                    </Link>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          {run.status === "COMPLETED" ? <Notice tone="success">{t("builder.run.completed")}</Notice> : null}
          {run.status === "FAILED" && run.errorMessage ? <Notice tone="danger" title={t("builder.run.failed")}>{run.errorMessage}</Notice> : null}
        </CardBody>
      </Card>

      {run.status === "DRAFT" ? (
        <Card>
          <CardHeader title={t("builder.setup.title")} description={t("builder.setup.description")} />
          <CardBody className="grid gap-4">
            <p className="text-sm">{run.websiteUrl ? t("builder.setup.website", { url: run.websiteUrl }) : t("builder.setup.noWebsite")}</p>
            <p className="text-sm text-muted-foreground">{t("builder.setup.brainCount", { count: brainCount })}</p>
            {canBrain ? (
              <details className="rounded-md border" open>
                <summary className="cursor-pointer p-3 text-sm font-medium">{t("builder.setup.documents")}</summary>
                <div className="p-3 pt-0">
                  <AddDocumentForm organizationId={org.id} companyId={run.companyId} />
                </div>
              </details>
            ) : null}
            {canSales ? (
              <details className="rounded-md border" open={run.mode === "IMPORT"}>
                <summary className="cursor-pointer p-3 text-sm font-medium">{t("builder.setup.crm")}</summary>
                <CrmCsvImport base={companyBase} />
              </details>
            ) : null}
            {canHr ? (
              <details className="rounded-md border" open={run.mode === "IMPORT"}>
                <summary className="cursor-pointer p-3 text-sm font-medium">{t("builder.setup.employees")}</summary>
                <HrCsvImport endpoint={`${companyBase}/hr/employees/import`} columns={CSV_HEADER} />
              </details>
            ) : null}
            <Notice tone="info" action={<Button asChild size="sm" variant="secondary"><Link href={`/${locale}/products`}>{t("builder.setup.productsLink")}</Link></Button>}>
              {t("builder.setup.products")}
            </Notice>
            {canManage ? <StartRunButton base={base} /> : null}
          </CardBody>
        </Card>
      ) : null}

      {openDecisions.length ? (
        <div id="decisions" className="grid gap-4">
          {openDecisions.map((d) => (
            <DecisionCard key={d.id} base={base} decision={{ id: d.id, kind: d.kind, options: d.options }} canManage={canManage} />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t("builder.run.steps")} description={t("builder.run.stepsDescription")} />
          <ol className="divide-y">
            {steps.map((s, i) => {
              const task = s.agentTaskId ? v.tasks.get(s.agentTaskId) : null;
              const doc = s.brainDocumentId ? v.docs.get(s.brainDocumentId) : null;
              return (
                <li key={s.id} className="grid gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="font-medium">{t(`builder.steps.${s.key}`)}</span>
                    <Badge tone={STEP_TONE[s.status]} pulse={s.status === "RUNNING"}>
                      {t(`builder.stepStatus.${s.status}`)}
                    </Badge>
                    {s.profile ? <span className="text-xs text-muted-foreground">{t(`profiles.${s.profile}.name`)}</span> : null}
                    {s.attempts > 1 ? <span className="text-xs text-muted-foreground">{t("builder.run.attempts", { count: s.attempts })}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-3 ps-8 text-xs">
                    {doc ? (
                      <Link className="text-primary hover:underline" href={`/${locale}/brain/${doc.id}`}>
                        {t("builder.run.document")}
                      </Link>
                    ) : null}
                    {task && canSeeTasks ? (
                      <Link className="text-primary hover:underline" href={`/${locale}/tasks/${task.id}`}>
                        {t("builder.run.task", { status: t(`agentTasks.status.${task.status}`) })}
                      </Link>
                    ) : null}
                    {s.completedAt && s.status === "COMPLETED" ? <span className="text-muted-foreground">{formatDateTime(s.completedAt, locale, tz)}</span> : null}
                  </div>
                  {s.status === "FAILED" ? (
                    <div className="grid gap-2 ps-8">
                      <Notice tone="danger" title={s.errorCode ? (t(`errors.reasons.${s.errorCode}`) !== `errors.reasons.${s.errorCode}` ? t(`errors.reasons.${s.errorCode}`) : s.errorCode) : t("builder.run.failed")}>
                        {s.errorMessage}
                        {s.errorIssues.length ? (
                          <ul className="mt-1 list-disc ps-4 font-mono text-[11px]">
                            {s.errorIssues.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
                        ) : null}
                      </Notice>
                      {canManage && run.status !== "CANCELLED" ? <RetryStep base={base} stepId={s.id} /> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<FileText />} title={t("builder.run.documents")} />
            <CardBody>
              {docs.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {docs.map(({ step, doc }) => (
                    <li key={doc.id}>
                      <Link className="hover:underline" href={`/${locale}/brain/${doc.id}`}>
                        {t(`builder.steps.${step}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("builder.run.noDocuments")}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Building2 />} title={t("builder.run.structure")} actions={<Link className="text-xs text-primary hover:underline" href={`/${locale}/organization`}>{t("builder.run.view")}</Link>} />
            <CardBody>
              {v.departments.length ? (
                <ul className="grid gap-2 text-sm">
                  {v.departments.map((d) => (
                    <li key={d.id}>
                      <span className="font-medium">{d.name}</span>
                      {d.teams.length ? <span className="block text-xs text-muted-foreground">{d.teams.map((x) => x.name).join(", ")}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("builder.run.noStructure")}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Package />} title={t("builder.run.products")} actions={<Link className="text-xs text-primary hover:underline" href={`/${locale}/graph`}>{t("builder.run.view")}</Link>} />
            <CardBody>
              {v.products.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {v.products.map((p) => (
                    <li key={p.id}>
                      <Link className="hover:underline" href={`/${locale}/graph/${p.id}`}>
                        {p.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("builder.run.noProducts")}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Bot />} title={t("builder.run.aiEmployees")} actions={<Link className="text-xs text-primary hover:underline" href={`/${locale}/workforce`}>{t("builder.run.view")}</Link>} />
            <CardBody>
              {v.aiEmployees.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {v.aiEmployees.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2">
                      <Link className="hover:underline" href={`/${locale}/workforce/${e.id}`}>
                        {e.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">{t(`profiles.${e.profileKey}.name`)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("builder.run.noAiEmployees")}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<FolderKanban />} title={t("builder.run.projects")} />
            <CardBody>
              {v.projects.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {v.projects.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                      <Link className="hover:underline" href={`/${locale}/projects/${p.id}`}>
                        {p.name}
                      </Link>
                      <span className="text-xs tabular-nums text-muted-foreground">{t("builder.decisions.tasks", { count: p._count.workTasks })}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("builder.run.noProjects")}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Target />} title={t("builder.run.objectives")} actions={<Link className="text-xs text-primary hover:underline" href={`/${locale}/objectives`}>{t("builder.run.view")}</Link>} />
            <CardBody>
              {v.objectives.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {v.objectives.map((o) => (
                    <li key={o.id}>{o.title}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("builder.run.noObjectives")}</p>
              )}
              {Object.keys(v.installed).length ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("builder.run.installed", { list: Object.entries(v.installed).map(([k, n]) => `${t(`builder.entities.${k}`)}: ${n}`).join(" · ") })}
                </p>
              ) : null}
            </CardBody>
          </Card>
          {v.sources.length ? (
            <Card>
              <CardHeader title={t("builder.run.sources")} />
              <CardBody>
                <ul className="grid gap-1.5 text-sm">
                  {v.sources.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2">
                      <Badge tone={s.status === "INGESTED" ? "success" : "danger"}>{t(`builder.sourceStatus.${s.status}`)}</Badge>
                      {s.brainDocumentId ? (
                        <Link className="min-w-0 truncate hover:underline" href={`/${locale}/brain/${s.brainDocumentId}`}>
                          {s.title}
                        </Link>
                      ) : (
                        <span className="min-w-0 truncate">{s.url ?? s.title}</span>
                      )}
                      {s.errorMessage ? <span className="font-mono text-[11px] text-muted-foreground">{s.errorMessage}</span> : null}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </BuilderFrame>
  );
}
