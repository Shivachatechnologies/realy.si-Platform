import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { BulkTable, SaveSegment } from "@/components/crm/kit";
import { DealForm } from "@/components/crm/record-forms";
import { CrmFrame, DEAL_STATUS_TONE, Pager, Stat, TagList, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { accountOptions } from "@/server/modules/crm/accounts";
import { isUuid } from "@/server/modules/crm/common";
import { listSegments, sourceNames } from "@/server/modules/crm/config";
import { contactOptions } from "@/server/modules/crm/contacts";
import { listFieldDefs } from "@/server/modules/crm/custom-fields";
import { DEAL_STATUSES, listDeals, parseDealFilters } from "@/server/modules/crm/deals";
import { listPipelines } from "@/server/modules/crm/pipelines";
import { listOwners } from "@/server/modules/crm/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.deals") };
}

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const query = await searchParams;
  if (!c.company || !c.canRead) return <CrmFrame active="deals">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer } = c;
  const filters = parseDealFilters(query);
  const [list, owners, pipelines, accounts, contacts, sources, fields, segments] = await Promise.all([
    listDeals(viewer.ctx, org.id, company.id, filters),
    listOwners(viewer.ctx, org.id, company.id),
    listPipelines(viewer.ctx, org.id, company.id),
    accountOptions(viewer.ctx, org.id, company.id),
    contactOptions(viewer.ctx, org.id, company.id),
    sourceNames(viewer.ctx, org.id, company.id),
    listFieldDefs(viewer.ctx, org.id, company.id, "DEAL"),
    listSegments(viewer.ctx, org.id, company.id, "DEAL"),
  ]);
  const active: Record<string, string> = {};
  for (const k of ["q", "pipeline", "stage", "owner", "status", "account", "source", "tag", "closeFrom", "closeTo", "stale", "sort"]) if (typeof query[k] === "string" && query[k]) active[k] = query[k] as string;
  const qs = new URLSearchParams(active).toString();
  const filtered = Object.keys(active).some((k) => k !== "sort");
  const money = (m: bigint, cur: string) => formatMoney({ amountMinor: m, currency: cur }, locale);
  const stages = pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipelineName: p.name })));
  const prefillAccount = typeof query.account === "string" && isUuid(query.account) ? query.account : "";
  const prefillContact = typeof query.contact === "string" && isUuid(query.contact) ? query.contact : "";
  const baseTotal = list.totals.find((x) => x.currency === company.baseCurrency)?.amountMinor ?? 0n;
  return (
    <CrmFrame
      active="deals"
      subtitle={t("crm.deals.subtitle")}
      actions={
        <Button asChild size="sm" variant="secondary">
          <a href={`${base}/crm/export/deals${qs ? `?${qs}` : ""}`}>
            <Download aria-hidden />
            {t("crm.exportCsv")}
          </a>
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("crm.deals.matching")} value={list.total} />
        <Stat label={t("crm.deals.totalAmount")} value={money(baseTotal, company.baseCurrency)} hint={list.totals.length > 1 ? t("crm.deals.otherCurrencies", { count: list.totals.length - 1 }) : undefined} />
        <Stat label={t("crm.deals.pageWeighted")} value={money(list.rows.filter((r) => r.currency === company.baseCurrency).reduce((s, r) => s + r.weightedMinor, 0n), company.baseCurrency)} />
      </div>
      {segments.length ? (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("crm.segments.title")}>
          <span className="text-xs text-muted-foreground">{t("crm.segments.title")}:</span>
          {segments.map((s) => (
            <Link key={s.id} href={`/${locale}/crm/deals?${new URLSearchParams(s.filters as Record<string, string>)}`} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
              {s.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <Card>
        <CardHeader title={t("crm.tabs.deals")} description={t("crm.deals.count", { count: list.total })} actions={<SaveSegment base={base} entity="DEAL" filters={active} />} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-4 lg:grid-cols-[minmax(0,1fr)_9rem_10rem_9rem_8rem_9rem_9rem_auto]" action={`/${locale}/crm/deals`}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("crm.search")} placeholder={t("crm.deals.searchPlaceholder")} />
          <Select name="pipeline" defaultValue={filters.pipelineId ?? ""} aria-label={t("crm.fields.pipeline")}>
            <option value="">{t("crm.allPipelines")}</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select name="stage" defaultValue={filters.stageId ?? ""} aria-label={t("crm.stage")}>
            <option value="">{t("crm.allStages")}</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {pipelines.length > 1 ? `${s.pipelineName} · ${s.name}` : s.name}
              </option>
            ))}
          </Select>
          <Select name="owner" defaultValue={filters.owner ?? ""} aria-label={t("crm.owner")}>
            <option value="">{t("crm.allOwners")}</option>
            <option value="me">{t("crm.mine")}</option>
            <option value="unassigned">{t("crm.unassigned")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("crm.deals.status")}>
            <option value="">{t("crm.deals.anyStatus")}</option>
            {DEAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`crm.dealStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Input name="closeFrom" type="date" defaultValue={filters.closeFrom ?? ""} aria-label={t("crm.deals.closeFrom")} title={t("crm.deals.closeFrom")} />
          <Input name="closeTo" type="date" defaultValue={filters.closeTo ?? ""} aria-label={t("crm.deals.closeTo")} title={t("crm.deals.closeTo")} />
          <div className="flex flex-wrap gap-2">
            <Select name="sort" defaultValue={filters.sort ?? ""} aria-label={t("crm.sort")} className="w-auto">
              <option value="">{t("crm.sortCreated")}</option>
              <option value="amount">{t("crm.deals.sortAmount")}</option>
              <option value="close">{t("crm.deals.sortClose")}</option>
              <option value="updated">{t("crm.sortUpdated")}</option>
            </Select>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="stale" value="1" defaultChecked={!!filters.stale} className="size-4 accent-primary" />
              {t("crm.deals.staleOnly")}
            </label>
            <Button type="submit" variant="secondary">
              {t("crm.applyFilters")}
            </Button>
            {filtered ? (
              <Link href={`/${locale}/crm/deals`} className="self-center text-xs text-muted-foreground hover:underline">
                {t("crm.clearFilters")}
              </Link>
            ) : null}
          </div>
        </form>
        {c.canManage ? (
          <details className="border-b" open={query.new === "1"}>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("crm.deals.add")}</summary>
            <DealForm
              base={base}
              locale={locale}
              owners={owners}
              accounts={accounts}
              contacts={contacts}
              pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name, type: s.type })) }))}
              sources={sources}
              fields={fields}
              currency={company.baseCurrency}
              viewerId={viewer.user.id}
              initial={{ accountId: prefillAccount, contactId: prefillContact }}
            />
          </details>
        ) : null}
        {list.rows.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("crm.deals.empty")}</p>
        ) : (
          <BulkTable
            url={`${base}/crm/deals/bulk`}
            canManage={c.canManage}
            columns={[
              { label: t("crm.name") },
              { label: t("crm.stage") },
              { label: t("crm.owner") },
              { label: t("crm.fields.amount"), align: "end" },
              { label: t("crm.weighted"), align: "end" },
              { label: t("crm.expectedClose") },
            ]}
            actions={[
              { kind: "assign", owners },
              { kind: "select", action: "stage", field: "stageId", label: t("crm.setStage"), options: stages.map((s) => ({ value: s.id, label: pipelines.length > 1 ? `${s.pipelineName} · ${s.name}` : s.name })) },
              { kind: "tag" },
              { kind: "archive" },
            ]}
            rows={list.rows.map((d) => ({
              id: d.id,
              label: d.name,
              cells: [
                <span key="n" className="grid gap-0.5">
                  <Link href={`/${locale}/crm/deals/${d.id}`} className="font-medium hover:underline">
                    {d.name}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {d.account?.name}
                    {d.staleSince ? <Badge tone="warning">{t("crm.deals.stale")}</Badge> : null}
                    <TagList tags={d.tags} />
                  </span>
                </span>,
                <span key="s" className="flex flex-wrap items-center gap-1">
                  <Badge tone={DEAL_STATUS_TONE[d.status]}>{d.stage.name}</Badge>
                  {pipelines.length > 1 ? <span className="text-xs text-muted-foreground">{d.pipeline.name}</span> : null}
                </span>,
                d.ownerName ?? <span className="text-muted-foreground">{t("crm.unassigned")}</span>,
                money(d.amountMinor, d.currency),
                <span key="w" title={t("crm.probabilityValue", { value: d.effectiveProbability })}>
                  {money(d.weightedMinor, d.currency)}
                </span>,
                d.expectedCloseDate ? formatDate(d.expectedCloseDate, locale, "UTC") : "—",
              ],
            }))}
          />
        )}
        <Pager path={`/${locale}/crm/deals`} query={query} page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </CrmFrame>
  );
}
