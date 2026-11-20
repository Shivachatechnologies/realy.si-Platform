import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ClipboardCheck, Gauge, ListChecks, Package, Siren, Workflow } from "lucide-react";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import { latestSubjectTask } from "@/components/guide-kit/server";
import { IncidentBoard, OpsIntro, OpsJourney } from "@/components/ops-hub/ops-visuals";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { OpsTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { incidentBoard } from "@/server/modules/cockpit/ops-insights";
import { operationsOverview } from "@/server/modules/work/operations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.title") };
}

export default async function OperationsPage() {
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"), t("work.ops.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canRunAgents, base } = w;
  const [o, board, helpTask] = await Promise.all([
    operationsOverview(viewer.ctx, org.id, company.id),
    incidentBoard(viewer.ctx, org.id, company.id),
    canRunAgents ? latestSubjectTask(viewer.ctx, org.id, company.id, "ops_overview", company.id) : null,
  ]);
  const p = `/${locale}/operations`;
  const journey = [
    { key: "process", done: o.processes > 0, href: `${p}/processes#start` },
    { key: "checklist", done: o.checklists > 0, href: `${p}/checklists#start` },
    { key: "assets", done: o.assets > 0, href: `${p}/assets` },
    { key: "incidents", done: o.recentIncidents.length > 0, href: `${p}/incidents` },
  ];
  const nextStep = journey.find((s) => !s.done);
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      <PageHeader icon={<Gauge />} eyebrow={t("opsHub.eyebrow")} title={t("work.ops.title")} description={t("work.ops.subtitle")}>
        <OpsTabs t={t} locale={locale} active="overview" />
      </PageHeader>
      <OpsIntro t={t} page="overview" next={nextStep ? { label: t(`opsHub.journey.steps.${nextStep.key}.title`), href: nextStep.href } : { label: t("opsHub.intro.overview.nextDone"), href: `${p}/checklists` }} />
      <StatGrid>
        <StatTile index={0} label={t("work.ops.stats.processes")} value={o.processes} icon={<Workflow />} href={`${p}/processes`} />
        <StatTile index={1} label={t("work.ops.stats.openRuns")} value={o.openRuns} icon={<ListChecks />} hint={t("opsHub.stats.checklists", { count: o.checklists })} href={`${p}/checklists`} />
        <StatTile index={2} label={t("work.ops.stats.openIncidents")} value={o.openIncidents} icon={<AlertTriangle />} live={o.sev12 > 0} hint={t("opsHub.stats.sev12", { count: o.sev12 })} highlight={o.sev12 > 0} href={`${p}/incidents`} />
        <StatTile index={3} label={t("work.ops.stats.assets")} value={o.assets} icon={<Package />} href={`${p}/assets`} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card variant="highlight">
          <CardHeader icon={<ClipboardCheck />} title={t("opsHub.journey.title")} description={t("opsHub.journey.hint")} />
          <CardBody>
            <OpsJourney steps={journey} t={t} />
          </CardBody>
        </Card>
        <Card variant="glass">
          <CardHeader title={t("opsHub.help.title")} description={t("opsHub.help.hint")} />
          <CardBody>
            <HelpMeButton
              base={base.replace(/\/work$/, "")}
              aiReady={aiConfigured() && canRunAgents}
              profile="operations_assistant"
              subject={{ type: "ops_overview", id: company.id }}
              title="Help me organise my operations"
              instructions={`The person runs ${company.name} and is not an operations expert. They are on the Operations page. Current state: ${o.processes} written processes, ${o.checklists} recurring checklists (${o.openRuns} open runs), ${o.assets} registered assets, ${o.openIncidents} open incidents (${o.sev12} serious). Read the company's documents and objectives, then suggest in plain words: the 3 most important routines they should write down as processes (each with 5-8 short steps they can paste into "Set up a process"), and 2 recurring checklists (each with its items and how often). Keep it practical for a small company.`}
              initial={helpTask}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Siren />} title={t("opsHub.incidents.boardTitle")} description={t("opsHub.incidents.boardHint")} actions={<Link href={`${p}/incidents`} className="text-xs text-primary hover:underline">{t("work.ops.tabs.incidents")}</Link>} />
        <CardBody>
          <IncidentBoard incidents={board} t={t} locale={locale} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={<ListChecks />} title={t("work.ops.dueRuns")} />
        {o.dueRuns.length ? (
          <ul className="grid divide-y">
            {o.dueRuns.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                <Link href={`${p}/checklists/${r.checklist.id}`} className="min-w-0 flex-1 truncate hover:underline">
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
    </div>
  );
}
