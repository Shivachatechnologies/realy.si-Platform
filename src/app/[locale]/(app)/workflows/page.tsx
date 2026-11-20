import type { Metadata } from "next";
import Link from "next/link";
import { RUN_TONE, WORKFLOW_TONE, workflowsPage } from "@/components/automation/frame";
import { eventLabelKey } from "@/components/automation/labels";
import { Stat } from "@/components/automation/page-frame";
import { NewWorkflowForm } from "@/components/automation/workflow-forms";
import { Notice } from "@/components/ui/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { listRuns, listWorkflows, parseWorkflowFilters, WORKFLOW_STATUSES, workflowOverview } from "@/server/modules/automation/service";
import { WORKFLOW_TEMPLATES } from "@/server/modules/automation/templates";
import { connectedCount } from "@/server/modules/integrations/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.workflows.title") };
}

export default async function WorkflowsPage({ searchParams }: PageProps<"/[locale]/workflows">) {
  const p = await workflowsPage("workflows");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, canManage, tz, base } = p.ctx;
  const filters = parseWorkflowFilters(await searchParams);
  const filtered = !!(filters.q || filters.status);
  const [workflows, overview, recent, integrations] = await Promise.all([
    listWorkflows(viewer.ctx, org.id, company.id, filters),
    workflowOverview(viewer.ctx, org.id, company.id),
    listRuns(viewer.ctx, org.id, company.id, {}, 8),
    connectedCount(org.id, company.id),
  ]);
  const trigger = (w: (typeof workflows)[number]) => {
    const tr = w.draftTrigger;
    if (w.triggerType === "event" && w.triggerKey) return t(eventLabelKey(w.triggerKey));
    if (tr.type === "event") return t(eventLabelKey(tr.event));
    return t(`workflows.builder.triggerTypes.${w.triggerType ?? tr.type}`);
  };
  return p.render(
    <>
      {overview.deadLetters ? (
        <Notice tone="danger">
          {t("workflows.runs.deadSummary", { count: overview.deadLetters })}{" "}
          <Link href={`/${locale}/workflows/runs?view=dead`} className="font-medium underline">
            {t("workflows.runs.views.dead")}
          </Link>
        </Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={t("workflows.metrics.activeWorkflows")} value={overview.active} />
        <Stat label={t("workflows.metrics.runs")} value={overview.runs} hint={t("workflows.last30Days")} />
        <Stat label={t("workflows.metrics.failedRuns")} value={overview.failed} hint={t("workflows.last30Days")} />
        <Stat label={t("workflows.metrics.successRate")} value={overview.successRate === null ? "—" : `${overview.successRate}%`} hint={t("workflows.last30Days")} />
        <Stat label={t("integrations.metrics.connected")} value={<Link href={`/${locale}/integrations?view=connected`} className="hover:underline">{integrations}</Link>} />
      </div>

      <Card>
        <CardHeader title={t("workflows.tabs.workflows")} description={t("workflows.count", { count: workflows.length })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" action={`/${locale}/workflows`}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} placeholder={t("workflows.searchPlaceholder")} aria-label={t("workflows.search")} />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("workflows.allStatuses")}</option>
            {WORKFLOW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`workflows.status.${s}`)}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              {t("integrations.applyFilters")}
            </Button>
            {filtered ? (
              <Link href={`/${locale}/workflows`} className="self-center text-xs text-muted-foreground hover:underline">
                {t("workflows.clearFilters")}
              </Link>
            ) : null}
          </div>
        </form>
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("workflows.new")}</summary>
            <NewWorkflowForm base={base} locale={locale} templates={WORKFLOW_TEMPLATES.map((x) => ({ key: x.key, name: t(`workflows.templates.${x.key}.name`) }))} />
          </details>
        ) : null}
        {workflows.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("workflows.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("workflows.name")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("workflows.trigger")}</Th>
                <Th>{t("workflows.version")}</Th>
                <Th className="text-end">{t("workflows.runs30d")}</Th>
                <Th className="text-end">{t("workflows.failed30d")}</Th>
                <Th>{t("workflows.owner")}</Th>
                <Th>{t("workflows.updated")}</Th>
              </Tr>
            </THead>
            <TBody>
              {workflows.map((w) => (
                <Tr key={w.id}>
                  <Td className="max-w-72">
                    <Link href={`/${locale}/workflows/${w.id}`} className="font-medium hover:underline">
                      {w.name}
                    </Link>
                    {w.description ? <p className="truncate text-xs text-muted-foreground">{w.description}</p> : null}
                  </Td>
                  <Td>
                    <Badge tone={WORKFLOW_TONE[w.status]}>{t(`workflows.status.${w.status}`)}</Badge>
                  </Td>
                  <Td className="text-sm">{trigger(w)}</Td>
                  <Td>{w.currentVersion ? `v${w.currentVersion}` : <span className="text-muted-foreground">{t("workflows.unpublished")}</span>}</Td>
                  <Td className="text-end tabular-nums">{w.runs30d}</Td>
                  <Td className="text-end tabular-nums">{w.failed30d ? <span className="text-danger">{w.failed30d}</span> : 0}</Td>
                  <Td className="text-sm">{w.ownerName ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(w.updatedAt, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={t("workflows.recentRuns")} actions={<Link href={`/${locale}/workflows/runs`} className="text-sm text-primary hover:underline">{t("workflows.viewAll")}</Link>} />
        {recent.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("workflows.runs.empty")}</p>
        ) : (
          <ul className="divide-y">
            {recent.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Badge tone={RUN_TONE[r.status]}>{t(`workflows.runStatus.${r.status}`)}</Badge>
                <Link href={`/${locale}/workflows/runs/${r.id}`} className="font-medium hover:underline">
                  {r.workflow.name}
                </Link>
                {r.isTest ? <Badge>{t("workflows.runs.test")}</Badge> : null}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.error ?? ""}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt, locale, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>,
  );
}
