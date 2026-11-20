import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import type { Translate } from "@/i18n/translate";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import type { campaignLeads, campaignPipeline } from "@/server/modules/marketing/analytics";
import { LEAD_STAGES } from "@/server/modules/marketing/analytics";
import { Kpi, Pager } from "./shell";
import { cn } from "@/lib/utils";

export const CAMPAIGN_VIEWS = ["overview", "leads", "pipeline"] as const;
export type CampaignView = (typeof CAMPAIGN_VIEWS)[number];

export function CampaignViewTabs({ path, active, t }: { path: string; active: CampaignView; t: Translate }) {
  return (
    <nav className="flex gap-1 overflow-x-auto text-sm" aria-label={t("marketing.campaigns.views")}>
      {CAMPAIGN_VIEWS.map((v) => (
        <Link
          key={v}
          href={v === "overview" ? path : `${path}?view=${v}`}
          aria-current={active === v ? "page" : undefined}
          className={cn("shrink-0 rounded-md px-3 py-1.5", active === v ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
        >
          {t(`marketing.campaigns.view.${v}`)}
        </Link>
      ))}
    </nav>
  );
}

type Leads = Awaited<ReturnType<typeof campaignLeads>>;
type Pipeline = Awaited<ReturnType<typeof campaignPipeline>>;

/** Read-only list of CRM leads attributed to the campaign (by campaign code / UTM). */
export function CampaignLeadsView({ data, path, locale, tz, t, f }: { data: Leads; path: string; locale: string; tz: string; t: Translate; f: { q?: string; stage?: string; page: number } }) {
  return (
    <Card>
      <CardHeader title={t("marketing.campaigns.view.leads")} description={t("marketing.campaigns.leadsHint")} />
      <div className="flex flex-wrap gap-2 border-b px-4 py-2 text-xs">
        {LEAD_STAGES.map((s) => (
          <span key={s} className="rounded-full bg-muted px-2 py-0.5">
            {t(`crm.stages.${s}`)}: {formatNumber(data.byStage[s] ?? 0, locale)}
          </span>
        ))}
      </div>
      <form className="flex flex-wrap gap-2 border-b p-3" action={path}>
        <input type="hidden" name="view" value="leads" />
        <Input className="min-w-0 flex-1" name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} placeholder={t("marketing.campaigns.searchLeads")} aria-label={t("marketing.campaigns.searchLeads")} />
        <Select name="stage" defaultValue={f.stage ?? ""} aria-label={t("marketing.campaigns.stage")} className="w-auto">
          <option value="">{t("marketing.campaigns.allStages")}</option>
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`crm.stages.${s}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          {t("marketing.common.apply")}
        </Button>
      </form>
      {data.data.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{f.q || f.stage ? t("common.noResults") : t("marketing.campaigns.noLeads")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.campaigns.leadName")}</Th>
                <Th>{t("marketing.campaigns.stage")}</Th>
                <Th>{t("marketing.campaigns.owner")}</Th>
                <Th className="text-end">{t("marketing.campaigns.value")}</Th>
                <Th>{t("marketing.campaigns.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {data.data.map((l) => (
                <Tr key={l.id}>
                  <Td>
                    <Link href={`/${locale}/crm/${l.id}`} className="font-medium hover:underline">
                      {l.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{[l.email, l.account].filter(Boolean).join(" · ")}</div>
                  </Td>
                  <Td>
                    <Badge tone={l.stage === "WON" ? "success" : l.stage === "LOST" ? "danger" : "neutral"}>{t(`crm.stages.${l.stage}`)}</Badge>
                  </Td>
                  <Td className="text-muted-foreground">{l.owner?.name ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{l.valueMinor != null ? formatMoney({ amountMinor: l.valueMinor, currency: l.currency }, locale) : "—"}</Td>
                  <Td className="text-muted-foreground">{formatDate(l.createdAt, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      <Pager path={path} params={{ view: "leads", q: f.q, stage: f.stage }} page={f.page} total={data.total} pageSize={data.pageSize} t={t} />
    </Card>
  );
}

/** Read-only CRM deals attributed to the campaign: pipeline, weighted pipeline and won revenue. */
export function CampaignPipelineView({ data, path, locale, t, f }: { data: Pipeline; path: string; locale: string; t: Translate; f: { status?: string; page: number } }) {
  const money = (amountMinor: bigint, currency: string) => formatMoney({ amountMinor, currency }, locale);
  return (
    <div className="grid gap-4">
      {data.totals.length === 0 ? null : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.totals.flatMap((x) => [
            <Kpi key={`o-${x.currency}`} label={t("marketing.campaigns.openPipeline")} value={money(x.open, x.currency)} hint={t("marketing.campaigns.dealsN", { count: x.openCount })} />,
            <Kpi key={`w-${x.currency}`} label={t("marketing.campaigns.weightedPipeline")} value={money(x.weighted, x.currency)} />,
            <Kpi key={`r-${x.currency}`} label={t("marketing.campaigns.wonRevenue")} value={money(x.won, x.currency)} hint={t("marketing.campaigns.dealsN", { count: x.wonCount })} tone="success" />,
            <Kpi key={`l-${x.currency}`} label={t("marketing.campaigns.lostRevenue")} value={money(x.lost, x.currency)} hint={t("marketing.campaigns.dealsN", { count: x.lostCount })} />,
          ])}
        </div>
      )}
      <Card>
        <CardHeader
          title={t("marketing.campaigns.view.pipeline")}
          description={`${t("marketing.campaigns.pipelineHint")}${data.winRate != null ? ` · ${t("marketing.campaigns.winRate")}: ${formatNumber(Math.round(data.winRate * 10) / 10, locale)}%` : ""}`}
        />
        <div className="flex flex-wrap gap-1 border-b px-4 py-2 text-sm">
          {(["", "OPEN", "WON", "LOST"] as const).map((s) => (
            <Link
              key={s || "all"}
              href={`${path}?view=pipeline${s ? `&status=${s}` : ""}`}
              aria-current={(f.status ?? "") === s ? "page" : undefined}
              className={cn("rounded-md px-2 py-1", (f.status ?? "") === s ? "bg-muted font-medium" : "hover:bg-muted")}
            >
              {s ? t(`marketing.campaigns.dealStatus.${s}`) : t("marketing.campaigns.allDeals")}
            </Link>
          ))}
        </div>
        {data.data.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("marketing.campaigns.noDeals")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("marketing.campaigns.deal")}</Th>
                  <Th>{t("marketing.campaigns.stage")}</Th>
                  <Th>{t("marketing.campaigns.owner")}</Th>
                  <Th className="text-end">{t("marketing.campaigns.amount")}</Th>
                  <Th>{t("marketing.campaigns.expectedClose")}</Th>
                </Tr>
              </THead>
              <TBody>
                {data.data.map((d) => (
                  <Tr key={d.id}>
                    <Td>
                      <Link href={`/${locale}/crm/deals/${d.id}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      {d.account ? <div className="text-xs text-muted-foreground">{d.account.name}</div> : null}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge tone={d.status === "WON" ? "success" : d.status === "LOST" ? "danger" : "neutral"}>{t(`marketing.campaigns.dealStatus.${d.status}`)}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {d.stage.name} · {d.probability ?? d.stage.probability}%
                        </span>
                      </span>
                    </Td>
                    <Td className="text-muted-foreground">{d.ownerName ?? "—"}</Td>
                    <Td className="text-end tabular-nums">{money(d.amountMinor, d.currency)}</Td>
                    <Td className="text-muted-foreground">{d.status === "OPEN" ? (d.expectedCloseDate ? formatDate(d.expectedCloseDate, locale, "UTC") : "—") : d.closedAt ? formatDate(d.closedAt, locale, "UTC") : "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <Pager path={path} params={{ view: "pipeline", status: f.status }} page={f.page} total={data.total} pageSize={data.pageSize} t={t} />
      </Card>
    </div>
  );
}
