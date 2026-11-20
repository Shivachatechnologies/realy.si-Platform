import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, CheckCircle2, ClipboardList, Hourglass, LifeBuoy, ListTodo, Timer, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { ActionButton } from "@/components/work/actions";
import { AiManagerStrip } from "@/components/work/ai-manager";
import { OpsTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { departmentManager } from "@/server/modules/cockpit/department-manager";
import { detectBottlenecks, type BottleneckArea } from "@/server/modules/work/bottlenecks";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.opsAnalytics.title") };
}

const AREA_ICON: Record<BottleneckArea, React.ReactNode> = { checklists: <ClipboardList />, workflows: <Workflow />, support: <LifeBuoy />, approvals: <Hourglass />, tasks: <ListTodo /> };
const SEV_TONE = { high: "danger", medium: "warning", low: "neutral" } as const;

/** Operations analytics: where work gets stuck across the company, from real records, with "fix this" actions. */
export default async function OperationsAnalyticsPage() {
  const t = await getT();
  const w = await workContext("operations", t("work.opsAnalytics.title"), t("work.opsAnalytics.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, base, tz } = w;
  const chain = await companyChain(db(), org.id, company.id);
  const [b, canTask, canAutomate, manager] = await Promise.all([
    detectBottlenecks(viewer.ctx, org.id, company.id),
    can(viewer.ctx, "projects.manage", chain),
    Promise.all([can(viewer.ctx, "workflows.manage", chain), can(viewer.ctx, "agents.run", chain)]).then(([a, c]) => a && c),
    departmentManager(company.id, ["operations_manager", "ai_project_manager"]),
  ]);
  const areas = ["checklists", "workflows", "support", "approvals", "tasks"] as const;
  const maxCycle = Math.max(1, ...b.cycle.projects.map((p) => p.medianDays), b.cycle.companyMedianDays ?? 0);

  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      <PageHeader icon={<Activity />} eyebrow={t("opsHub.eyebrow")} title={t("work.opsAnalytics.title")} description={t("work.opsAnalytics.subtitle")}>
        <OpsTabs t={t} locale={locale} active="analytics" />
      </PageHeader>
      <AiManagerStrip t={t} locale={locale} manager={manager} duty={t("work.opsAnalytics.duty")} />
      <StatGrid>
        {areas.map((a, i) => (
          <StatTile key={a} index={i} label={t(`work.opsAnalytics.areas.${a}`)} value={b.byArea[a]} icon={AREA_ICON[a]} highlight={b.items.some((x) => x.area === a && x.severity === "high")} />
        ))}
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader icon={<Activity />} title={t("work.opsAnalytics.bottlenecks")} description={t("work.opsAnalytics.checkedAt", { time: formatDateTime(b.checkedAt, locale, tz) })} />
          <CardBody className="grid gap-3">
            {b.items.length ? (
              <ul className="grid gap-3">
                {b.items.map((x) => (
                  <li key={x.key} className={cn("grid gap-2 rounded-lg border p-3", x.severity === "high" ? "border-danger/40" : x.severity === "medium" ? "border-warning/40" : "")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span aria-hidden className="grid size-7 place-items-center rounded-md bg-muted [&_svg]:size-3.5">
                        {AREA_ICON[x.area]}
                      </span>
                      <span className="min-w-0 flex-1 font-medium">{t(`work.opsAnalytics.kinds.${x.kind}`, { count: x.count })}</span>
                      <Badge tone={SEV_TONE[x.severity]}>{t(`work.opsAnalytics.severity.${x.severity}`)}</Badge>
                      <Badge>{t("work.opsAnalytics.age", { count: x.ageDays })}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{x.summary}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/${locale}${x.href}`} className="inline-flex min-h-8 items-center gap-1 rounded-md bg-muted px-2.5 text-sm font-medium hover:bg-muted/70">
                        {t("work.opsAnalytics.open")}
                        <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
                      </Link>
                      {canTask ? (
                        <ActionButton url={`${base}/operations/bottlenecks`} body={{ key: x.key, action: "task" }}>
                          {t("work.opsAnalytics.fixTask")}
                        </ActionButton>
                      ) : null}
                      {canAutomate ? (
                        <ActionButton url={`${base}/operations/bottlenecks`} body={{ key: x.key, action: "automation" }} variant="ghost">
                          {t("work.opsAnalytics.fixAutomation")}
                        </ActionButton>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="grid justify-items-center gap-2 py-8 text-center">
                <CheckCircle2 aria-hidden className="size-8 text-success" />
                <p className="font-medium">{t("work.opsAnalytics.clear")}</p>
                <p className="max-w-md text-sm text-muted-foreground">{t("work.opsAnalytics.clearHint")}</p>
              </div>
            )}
            {!b.visible.support || !b.visible.workflows || !b.visible.approvals || !b.visible.finance ? <p className="text-xs text-muted-foreground">{t("work.opsAnalytics.partial")}</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={<Timer />} title={t("work.opsAnalytics.cycleTitle")} description={b.cycle.companyMedianDays != null ? t("work.opsAnalytics.cycleHint", { days: b.cycle.companyMedianDays }) : t("work.opsAnalytics.cycleEmpty")} />
          <CardBody>
            {b.cycle.projects.length ? (
              <ul className="grid gap-2.5">
                {b.cycle.projects.map((p) => {
                  const slow = b.cycle.companyMedianDays != null && p.medianDays >= b.cycle.companyMedianDays * 1.5;
                  return (
                    <li key={p.projectId} className="grid gap-1">
                      <div className="flex items-center gap-2 text-sm">
                        <Link href={`/${locale}/projects/${p.projectId}`} className="min-w-0 flex-1 truncate hover:underline">
                          {p.name}
                        </Link>
                        <span className="tabular-nums text-muted-foreground">{t("work.opsAnalytics.days", { count: p.medianDays })}</span>
                      </div>
                      <div className="relative h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("work.opsAnalytics.days", { count: p.medianDays })}>
                        <div className={cn("h-full rounded-full", slow ? "bg-warning" : "bg-primary")} style={{ width: `${Math.max(3, (p.medianDays / maxCycle) * 100)}%` }} />
                        {b.cycle.companyMedianDays != null ? <span aria-hidden className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ insetInlineStart: `${(b.cycle.companyMedianDays / maxCycle) * 100}%` }} /> : null}
                      </div>
                      <span className="text-xs text-muted-foreground">{t("work.opsAnalytics.doneCount", { count: p.done })}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("work.opsAnalytics.cycleEmpty")}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
