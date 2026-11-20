import type { Metadata } from "next";
import Link from "next/link";
import { RUN_TONE, workflowsPage } from "@/components/automation/frame";
import { duration } from "@/components/automation/labels";
import { DeadLetterActions } from "@/components/automation/workflow-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { deadLetterCount, listDeadLetters, listRuns, parseRunFilters, RUN_STATUSES } from "@/server/modules/automation/service";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workflows.tabs.runs") };
}

export default async function RunsPage({ searchParams }: PageProps<"/[locale]/workflows/runs">) {
  const p = await workflowsPage("runs");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, tz, base, canExecute } = p.ctx;
  const sp = await searchParams;
  const view = sp.view === "dead" ? "dead" : "all";
  const filters = parseRunFilters(sp);
  const [workflows, deadCount] = await Promise.all([
    db().workflow.findMany({ where: { organizationId: org.id, companyId: company.id }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    deadLetterCount(org.id, company.id),
  ]);
  const params = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const all = { view: view === "dead" ? "dead" : undefined, status: filters.status, workflow: filters.workflowId, from: filters.from, to: filters.to, kind: filters.kind, ...extra };
    for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : "";
  };
  const viewTabs = (
    <div className="flex gap-1 border-b px-3 text-sm">
      {(["all", "dead"] as const).map((v) => (
        <Link
          key={v}
          href={`/${locale}/workflows/runs${v === "dead" ? "?view=dead" : ""}`}
          aria-current={view === v ? "page" : undefined}
          className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-2 py-2", view === v ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t(`workflows.runs.views.${v}`)}
          {v === "dead" && deadCount ? <span className="rounded-full bg-danger/15 px-1.5 text-[11px] font-medium text-danger">{deadCount}</span> : null}
        </Link>
      ))}
    </div>
  );

  if (view === "dead") {
    const page = await listDeadLetters(viewer.ctx, org.id, company.id, { workflowId: filters.workflowId, cursor: filters.cursor });
    return p.render(
      <Card>
        <CardHeader title={t("workflows.runs.deadTitle")} description={t("workflows.runs.deadHelp")} />
        {viewTabs}
        {page.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("workflows.runs.deadEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {page.data.map((r) => (
              <li key={r.id} className="grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/${locale}/workflows/${r.workflow.id}`} className="font-medium hover:underline">
                      {r.workflow.name}
                    </Link>
                    <Badge tone="danger">{t("workflows.runStatus.FAILED")}</Badge>
                    {r.steps[0] ? <span className="font-mono text-xs text-muted-foreground">{r.steps[0].stepId}</span> : null}
                  </div>
                  <p className="text-sm text-danger">{r.error}</p>
                  <p className="text-xs text-muted-foreground">
                    <Link href={`/${locale}/workflows/runs/${r.id}`} className="hover:underline">
                      {formatDateTime(r.createdAt, locale, tz)}
                    </Link>
                    {r.deadLetteredAt ? ` · ${t("workflows.runs.failedAt", { date: formatDateTime(r.deadLetteredAt, locale, tz) })}` : ""}
                  </p>
                </div>
                {canExecute ? <DeadLetterActions base={base} runId={r.id} /> : null}
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor ? (
          <div className="flex justify-end border-t p-3 text-sm">
            <Link href={`/${locale}/workflows/runs${params({ cursor: page.nextCursor })}`} className="hover:underline">
              {t("common.next")} →
            </Link>
          </div>
        ) : null}
      </Card>,
    );
  }

  const page = await listRuns(viewer.ctx, org.id, company.id, filters);
  const filtered = !!(filters.status || filters.workflowId || filters.from || filters.to || filters.kind);
  return p.render(
    <Card>
      <CardHeader title={t("workflows.tabs.runs")} description={t("workflows.runs.help")} />
      {viewTabs}
      <form className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,16rem)_11rem_10rem_10rem_9rem_auto]" action={`/${locale}/workflows/runs`}>
        <Select name="workflow" defaultValue={filters.workflowId ?? ""} aria-label={t("workflows.runs.workflow")}>
          <option value="">{t("workflows.runs.allWorkflows")}</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
          <option value="">{t("workflows.allStatuses")}</option>
          {RUN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`workflows.runStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={filters.from ?? ""} aria-label={t("workflows.runs.from")} title={t("workflows.runs.from")} />
        <Input type="date" name="to" defaultValue={filters.to ?? ""} aria-label={t("workflows.runs.to")} title={t("workflows.runs.to")} />
        <Select name="kind" defaultValue={filters.kind ?? ""} aria-label={t("workflows.runs.kind")}>
          <option value="">{t("workflows.runs.kinds.all")}</option>
          <option value="real">{t("workflows.runs.kinds.real")}</option>
          <option value="test">{t("workflows.runs.kinds.test")}</option>
        </Select>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary">
            {t("integrations.applyFilters")}
          </Button>
          {filtered ? (
            <Link href={`/${locale}/workflows/runs`} className="text-sm text-muted-foreground hover:underline">
              {t("workflows.clearFilters")}
            </Link>
          ) : null}
        </div>
      </form>
      {page.data.length === 0 ? (
        <p className="p-4 text-muted-foreground">{t("workflows.runs.empty")}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("workflows.runs.started")}</Th>
              <Th>{t("workflows.runs.workflow")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("workflows.trigger")}</Th>
              <Th>{t("workflows.version")}</Th>
              <Th>{t("workflows.runs.duration")}</Th>
              <Th>{t("workflows.runs.error")}</Th>
            </Tr>
          </THead>
          <TBody>
            {page.data.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap">
                  <Link href={`/${locale}/workflows/runs/${r.id}`} className="hover:underline">
                    {formatDateTime(r.createdAt, locale, tz)}
                  </Link>
                </Td>
                <Td>
                  <Link href={`/${locale}/workflows/${r.workflow.id}`} className="font-medium hover:underline">
                    {r.workflow.name}
                  </Link>
                  {r.isTest ? <Badge className="ms-2">{t("workflows.runs.test")}</Badge> : null}
                  {r.depth ? <Badge className="ms-2">{t("workflows.runs.depth", { depth: r.depth })}</Badge> : null}
                </Td>
                <Td>
                  <Badge tone={RUN_TONE[r.status]}>{t(`workflows.runStatus.${r.status}`)}</Badge>
                  {r.waitingFor ? <span className="ms-1 text-xs text-muted-foreground">{t(`workflows.runs.waiting_${r.waitingFor}`)}</span> : null}
                  {r.deadLetteredAt ? <Badge tone="danger" className="ms-1">{t("workflows.runs.deadBadge")}</Badge> : null}
                </Td>
                <Td className="text-sm">{t(`workflows.builder.triggerTypes.${r.triggerType}`)}</Td>
                <Td>{r.version ? `v${r.version.version}` : t("workflows.runs.draft")}</Td>
                <Td className="whitespace-nowrap text-xs text-muted-foreground">
                  {r.startedAt && r.finishedAt ? duration(r.finishedAt.getTime() - r.startedAt.getTime()) : "—"} · {t("workflows.runs.stepCount", { count: r._count.steps })}
                </Td>
                <Td className="max-w-80 truncate text-xs text-muted-foreground">{r.error ?? ""}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {page.nextCursor || filters.cursor ? (
        <div className="flex justify-between gap-2 border-t p-3 text-sm">
          {filters.cursor ? <Link href={`/${locale}/workflows/runs${params({ cursor: undefined })}`} className="hover:underline">{t("integrations.firstPage")}</Link> : <span />}
          {page.nextCursor ? <Link href={`/${locale}/workflows/runs${params({ cursor: page.nextCursor })}`} className="hover:underline">{t("common.next")} →</Link> : null}
        </div>
      ) : null}
    </Card>,
  );
}
