import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { OpsTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { SEVERITY_TONE, StatCard } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { operationsOverview } from "@/server/modules/work/operations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.title") };
}

export default async function OperationsPage() {
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"), t("work.ops.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, tz } = w;
  const o = await operationsOverview(viewer.ctx, org.id, company.id);
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <OpsTabs t={t} locale={locale} active="overview" />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={t("work.ops.stats.processes")} value={o.processes} />
        <StatCard label={t("work.ops.stats.checklists")} value={o.checklists} />
        <StatCard label={t("work.ops.stats.openRuns")} value={o.openRuns} tone={o.openRuns ? "warning" : undefined} />
        <StatCard label={t("work.ops.stats.assets")} value={o.assets} />
        <StatCard label={t("work.ops.stats.openIncidents")} value={o.openIncidents} tone={o.openIncidents ? "warning" : undefined} />
        <StatCard label={t("work.ops.stats.sev12")} value={o.sev12} tone={o.sev12 ? "danger" : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("work.ops.dueRuns")} />
          {o.dueRuns.length ? (
            <ul className="grid divide-y">
              {o.dueRuns.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <Link href={`/${locale}/operations/checklists/${r.checklist.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {r.checklist.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatDate(r.dueOn, locale, "UTC")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("work.ops.noDueRuns")}</p>
          )}
        </Card>
        <Card>
          <CardHeader title={t("work.ops.recentIncidents")} />
          {o.recentIncidents.length ? (
            <ul className="grid divide-y">
              {o.recentIncidents.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge>
                  <Link href={`/${locale}/operations/incidents/${i.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {i.title}
                  </Link>
                  <Badge>{t(`work.ops.incidentStatus.${i.status}`)}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDateTime(i.occurredAt, locale, tz)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("work.ops.noIncidents")}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
