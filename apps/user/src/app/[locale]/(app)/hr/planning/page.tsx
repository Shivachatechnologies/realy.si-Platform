import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Briefcase, CalendarRange, ClipboardList, Users, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { AiPanel } from "@/components/hr/ai-panel";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions, namedOptions } from "@/components/hr/options";
import { DepartmentBars, HeadcountTrajectory } from "@/components/hr/planning-visuals";
import { HrFrame, loadHr } from "@/components/hr/shell";
import { formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { EMPLOYMENT_TYPES } from "@/server/modules/hr/employees";
import { PLAN_PRIORITIES, PLANNING_SUBJECT, quarterKey, quarterStart, workforcePlan } from "@/server/modules/hr/planning";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.planning") };
}

const STATUS_TONE = { PLANNED: "neutral", APPROVED: "accent", HIRING: "warning", FILLED: "success", CANCELLED: "neutral" } as const;
const PRIORITY_TONE = { LOW: "neutral", MEDIUM: "accent", HIGH: "warning", CRITICAL: "danger" } as const;

/** Workforce planning: which roles the company will need, when, and what they cost — then hire them with one click. */
export default async function PlanningPage() {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.planning.title"), subtitle: t("hr.planning.subtitle"), tab: "planning" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const manage = access!.manage;
  const [plan, tasks] = await Promise.all([
    workforcePlan(viewer.ctx, org.id, company.id),
    access!.agentsRun ? listSubjectTasks(viewer.ctx, org.id, company.id, PLANNING_SUBJECT, company.id, 5).catch(() => []) : Promise.resolve([]),
  ]);
  const money = (v: bigint) => formatMoney({ amountMinor: v, currency: plan.currency }, locale);
  const qLabel = (key: string) => key.replace("-", " ");
  const nextQuarter = quarterStart(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 3, 1)));
  const groups = new Map<string, typeof plan.plans>();
  for (const p of plan.plans) {
    const k = quarterKey(p.targetStart);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const steps = ["list", "approve", "hire"] as const;

  return (
    <HrFrame {...frame}>
      {!plan.plans.length ? (
        <section aria-label={t("hr.planning.guide.title")} className="reveal grid gap-4 rounded-xl border bg-[linear-gradient(120deg,color-mix(in_oklch,var(--primary)_8%,var(--surface)),var(--surface)_65%)] p-5 shadow-elev-1">
          <div className="grid gap-1">
            <h2 className="font-display text-2xl">{t("hr.planning.guide.title")}</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("hr.planning.guide.intro")}</p>
          </div>
          <ol className="grid gap-3 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s} className="grid content-start gap-1 rounded-lg border bg-surface p-3">
                <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                <span className="font-medium">{t(`hr.planning.guide.steps.${s}.title`)}</span>
                <span className="text-sm text-muted-foreground">{t(`hr.planning.guide.steps.${s}.text`)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <StatGrid>
        <StatTile index={0} label={t("hr.planning.stats.today")} value={plan.totals.currentHeadcount} icon={<Users />} href={`/${locale}/hr/employees`} />
        <StatTile index={1} label={t("hr.planning.stats.planned")} value={plan.totals.plannedPeople} icon={<ClipboardList />} hint={t("hr.planning.stats.plannedHint", { approved: plan.totals.approved, hiring: plan.totals.hiring })} />
        <StatTile index={2} label={t("hr.planning.stats.annualCost")} money={{ amountMinor: plan.totals.plannedAnnualCost.toString(), currency: plan.currency }} icon={<Wallet />} />
        <StatTile index={3} label={t("hr.planning.stats.monthlyCost")} money={{ amountMinor: plan.totals.monthlyCost.toString(), currency: plan.currency }} icon={<CalendarRange />} hint={t("hr.planning.stats.monthlyHint")} href={`/${locale}/finance/cashflow`} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t("hr.planning.trajectory")} description={t("hr.planning.trajectoryHint")} />
          <CardBody>
            {plan.quarters.length ? (
              <HeadcountTrajectory
                title={t("hr.planning.trajectory")}
                todayLabel={t("hr.planning.today")}
                current={plan.totals.currentHeadcount}
                quarters={plan.quarters.map((q) => ({ key: q.key, label: qLabel(q.key), people: q.people, cost: q.annualCostMinor ? money(q.annualCostMinor) : "" }))}
              />
            ) : (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t("hr.planning.noQuarters")}</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.planning.byDepartment")} description={t("hr.planning.byDepartmentHint")} actions={<Link href={`/${locale}/organization`} className="text-xs text-muted-foreground hover:underline">{t("hr.planning.editDepartments")}</Link>} />
          <CardBody>
            {plan.departments.length ? (
              <DepartmentBars
                labels={{ current: t("hr.planning.current"), planned: t("hr.planning.plannedLegend") }}
                rows={plan.departments.map((d) => ({ key: d.id ?? "none", name: d.name ?? t("hr.noDepartment"), current: d.current, planned: d.planned, cost: d.annualCostMinor ? money(d.annualCostMinor) : "" }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.planning.noPeople")}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("hr.planning.roles")} description={t("hr.planning.rolesHint")} />
          {plan.plans.length ? (
            <div className="grid gap-4 p-3">
              {[...groups].map(([key, rows]) => (
                <section key={key} aria-label={qLabel(key)} className="grid gap-2">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{qLabel(key)}</h3>
                  <ul className="grid gap-2">
                    {rows.map((p) => (
                      <li key={p.id} className="grid gap-2 rounded-lg border bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="grid min-w-0 gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {p.headcount > 1 ? `${p.headcount} × ` : ""}
                              {p.title}
                            </span>
                            <Badge tone={STATUS_TONE[p.status]}>{t(`hr.planning.status.${p.status}`)}</Badge>
                            <Badge tone={PRIORITY_TONE[p.priority]}>{t(`hr.planning.priority.${p.priority}`)}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {[p.departmentName ?? t("hr.noDepartment"), t(`hr.employmentType.${p.employmentType}`), p.annualCostMinor ? t("hr.planning.perYear", { amount: money(p.annualCostMinor) }) : null].filter(Boolean).join(" · ")}
                          </p>
                          {p.reason ? <p className="line-clamp-2 text-sm text-muted-foreground">{p.reason}</p> : null}
                          {p.status === "HIRING" && p.job ? (
                            <p className="text-xs">
                              {t("hr.planning.hiredOf", { hired: p.hired, total: p.headcount })} ·{" "}
                              <Link href={`/${locale}/hr/hire?job=${p.job.id}`} className="font-medium text-primary hover:underline">
                                {t("hr.planning.openHiring")}
                              </Link>
                            </p>
                          ) : null}
                        </div>
                        {manage ? (
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                            {p.status === "PLANNED" ? <ActionButton endpoint={`${base}/hr/headcount-plans/${p.id}`} method="PATCH" body={{ status: "APPROVED" }} label={t("hr.planning.approve")} icon={<BadgeCheck aria-hidden />} /> : null}
                            {p.status === "PLANNED" || p.status === "APPROVED" ? (
                              <ActionButton endpoint={`${base}/hr/headcount-plans/${p.id}/hire`} label={t("hr.planning.startHiring")} variant="default" icon={<Briefcase aria-hidden />} redirectTo="/hr/hire?job=:id" busyLabel={t("hr.planning.starting")} />
                            ) : null}
                            {p.status === "PLANNED" || p.status === "APPROVED" || p.status === "HIRING" ? (
                              <ActionButton endpoint={`${base}/hr/headcount-plans/${p.id}`} method="PATCH" body={{ status: "CANCELLED" }} label={t("hr.planning.cancel")} variant="ghost" confirm={t("hr.planning.confirmCancel")} />
                            ) : null}
                            {!p.jobId ? <ActionButton endpoint={`${base}/hr/headcount-plans/${p.id}`} method="DELETE" label={t("hr.delete")} variant="ghost" confirm={t("hr.confirmDelete")} /> : null}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("hr.planning.empty")}</p>
          )}
          {manage ? (
            <details className="border-t" open={!plan.plans.length}>
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.planning.add")}</summary>
              <HrForm
                className="px-3 pb-3"
                endpoint={`${base}/hr/headcount-plans`}
                fields={[
                  { name: "title", label: t("hr.planning.fields.title"), required: true, placeholder: t("hr.planning.fields.titlePlaceholder") },
                  { name: "headcount", label: t("hr.planning.fields.headcount"), type: "number", min: 1, max: 500 },
                  { name: "targetStart", label: t("hr.planning.fields.targetStart"), type: "date", required: true, hint: t("hr.planning.fields.targetStartHint") },
                  { name: "departmentId", label: t("hr.department"), type: "select", options: namedOptions(plan.departmentOptions) },
                  { name: "employmentType", label: t("hr.employmentTypeLabel"), type: "select", options: enumOptions(t, "hr.employmentType", EMPLOYMENT_TYPES) },
                  { name: "priority", label: t("hr.planning.fields.priority"), type: "select", options: enumOptions(t, "hr.planning.priority", PLAN_PRIORITIES) },
                  { name: "annualCost", label: t("hr.planning.fields.annualCost", { currency: plan.currency }), type: "money", hint: t("hr.planning.fields.annualCostHint") },
                  { name: "reason", label: t("hr.planning.fields.reason"), type: "textarea", rows: 3, full: true, placeholder: t("hr.planning.fields.reasonPlaceholder") },
                ]}
                initial={{ headcount: 1, targetStart: nextQuarter.toISOString().slice(0, 10), employmentType: "FULL_TIME", priority: "MEDIUM" }}
                submitLabel={t("hr.planning.addSubmit")}
              />
            </details>
          ) : null}
        </Card>
        {access!.agentsRun ? (
          <div className="grid content-start gap-3">
            <Card>
              <CardHeader title={t("hr.planning.ai.title")} description={t("hr.planning.ai.hint")} />
              <CardBody>
                {manage ? (
                  <HrForm
                    endpoint={`${base}/hr/headcount-plans/assist`}
                    columns={1}
                    fields={[{ name: "guidance", label: t("hr.planning.ai.guidance"), type: "textarea", rows: 3, placeholder: t("hr.planning.ai.placeholder") }]}
                    submitLabel={t("hr.planning.ai.run")}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t("errors.forbidden")}</p>
                )}
              </CardBody>
            </Card>
            <AiPanel t={t} locale={locale} tz={tz} title={t("hr.planning.ai.results")} description={t("hr.planning.ai.resultsHint")} actions={[]} tasks={tasks} canRun={false} />
          </div>
        ) : null}
      </div>
    </HrFrame>
  );
}
