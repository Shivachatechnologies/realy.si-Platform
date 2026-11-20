import type { Metadata } from "next";
import Link from "next/link";
import { RUN_TONE, workflowsPage } from "@/components/automation/frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listRuns, parseRunFilters, RUN_STATUSES } from "@/server/modules/automation/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workflows.tabs.runs") };
}

export default async function RunsPage({ searchParams }: PageProps<"/[locale]/workflows/runs">) {
  const p = await workflowsPage("runs");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, tz } = p.ctx;
  const filters = parseRunFilters(await searchParams);
  const [page, workflows] = await Promise.all([
    listRuns(viewer.ctx, org.id, company.id, filters),
    db().workflow.findMany({ where: { organizationId: org.id, companyId: company.id }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
  ]);
  const qs = (cursor?: string) => `?${new URLSearchParams({ ...(filters.status ? { status: filters.status } : {}), ...(filters.workflowId ? { workflow: filters.workflowId } : {}), ...(cursor ? { cursor } : {}) })}`;
  return p.render(
    <Card>
      <CardHeader title={t("workflows.tabs.runs")} description={t("workflows.runs.help")} />
      <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,16rem)_12rem_auto]" action={`/${locale}/workflows/runs`}>
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
        <div>
          <Button type="submit" variant="secondary">
            {t("integrations.applyFilters")}
          </Button>
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
                </Td>
                <Td className="text-sm">{t(`workflows.builder.triggerTypes.${r.triggerType}`)}</Td>
                <Td>{r.version ? `v${r.version.version}` : t("workflows.runs.draft")}</Td>
                <Td className="max-w-80 truncate text-xs text-muted-foreground">{r.error ?? ""}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {page.nextCursor || filters.cursor ? (
        <div className="flex justify-between gap-2 border-t p-3 text-sm">
          {filters.cursor ? <Link href={`/${locale}/workflows/runs${qs()}`} className="hover:underline">{t("integrations.firstPage")}</Link> : <span />}
          {page.nextCursor ? <Link href={`/${locale}/workflows/runs${qs(page.nextCursor)}`} className="hover:underline">{t("common.next")} →</Link> : null}
        </div>
      ) : null}
    </Card>,
  );
}
