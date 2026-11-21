import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, FileText, Scale, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { UsageBar } from "@/components/finance/widgets";
import { ActionButton, AiButton } from "@/components/work/actions";
import { AiPanel } from "@/components/work/ai-panel";
import { AiManagerStrip } from "@/components/work/ai-manager";
import { getT } from "@/i18n/server";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { departmentManager } from "@/server/modules/cockpit/department-manager";
import { budgetVarianceExplanations, expenseCategorySuggestions, listMemoTasks, revenueForecast } from "@/server/modules/finance/manager";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.manager") };
}

const STATUS_TONE = { over: "danger", trending_over: "warning", watch: "warning", on_track: "success" } as const;

/** The AI Finance Manager's desk: monthly memo, revenue outlook, budget explanations and categorisation suggestions. */
export default async function FinanceManagerPage() {
  const p = await financePage("manager");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, tz, base, canManage, canRunAgents } = p;
  const [forecast, variance, suggestions, memos, manager] = await Promise.all([
    revenueForecast(viewer.ctx, org.id, company.id, 6),
    budgetVarianceExplanations(viewer.ctx, org.id, company.id),
    expenseCategorySuggestions(viewer.ctx, org.id, company.id),
    canRunAgents ? listMemoTasks(viewer.ctx, org.id, company.id) : [],
    departmentManager(company.id, ["ai_cfo"]),
  ]);
  const max = forecast.months.reduce((m, r) => (r.totalMinor > m ? r.totalMinor : m), 0n);
  const pct = (v: bigint) => (max > 0n ? Number((v * 1000n) / max) / 10 : 0);
  const monthLabel = (k: string) => new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));

  return p.frame(
    <div className="grid gap-4">
      <AiManagerStrip t={t} locale={locale} manager={manager} duty={t("finance.manager.duty")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Card>
          <CardHeader icon={<BarChart3 />} title={t("finance.manager.forecast.title")} description={t("finance.manager.forecast.hint")} />
          <CardBody className="grid gap-4">
            <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label={t("finance.manager.forecast.legend")}>
              <li className="flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm bg-success" />{t("finance.manager.forecast.recurring")}</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm bg-primary" />{t("finance.manager.forecast.receivables")}</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm border border-dashed border-primary bg-primary/15" />{t("finance.manager.forecast.pipeline")}</li>
            </ul>
            {max === 0n ? (
              <p className="text-sm text-muted-foreground">{t("finance.manager.forecast.empty")}</p>
            ) : (
              <div className="grid grid-cols-6 items-end gap-2" role="img" aria-label={t("finance.manager.forecast.title")}>
                {forecast.months.map((m) => (
                  <div key={m.month} className="grid gap-1 text-center">
                    <span className="truncate text-[11px] tabular-nums text-muted-foreground">{money(m.totalMinor)}</span>
                    <div className="flex h-40 flex-col-reverse overflow-hidden rounded-md bg-muted/40">
                      <div className="bg-success motion-safe:transition-all" style={{ height: `${pct(m.recurringMinor)}%` }} title={`${t("finance.manager.forecast.recurring")}: ${money(m.recurringMinor)}`} />
                      <div className="bg-primary motion-safe:transition-all" style={{ height: `${pct(m.receivablesMinor)}%` }} title={`${t("finance.manager.forecast.receivables")}: ${money(m.receivablesMinor)}`} />
                      <div className="border border-dashed border-primary bg-primary/15" style={{ height: `${pct(m.pipelineMinor)}%` }} title={`${t("finance.manager.forecast.pipeline")}: ${money(m.pipelineMinor)}`} />
                    </div>
                    <span className="text-xs">{monthLabel(m.month)}</span>
                  </div>
                ))}
              </div>
            )}
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {(
                [
                  ["recurring", forecast.totals.recurringMinor],
                  ["receivables", forecast.totals.receivablesMinor],
                  ["pipeline", forecast.totals.pipelineMinor],
                  ["total", forecast.totals.totalMinor],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-md bg-muted/50 p-2">
                  <dt className="text-xs text-muted-foreground">{t(`finance.manager.forecast.${k}`)}</dt>
                  <dd className="font-medium tabular-nums">{money(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              {forecast.pipeline === "included"
                ? t("finance.manager.forecast.pipelineIncluded", { count: forecast.openDeals ?? 0 })
                : forecast.pipeline === "no_access"
                  ? t("finance.manager.forecast.pipelineNoAccess")
                  : t("finance.manager.forecast.pipelineUnavailable")}{" "}
              {t("finance.manager.forecast.projectionNote")}
            </p>
          </CardBody>
        </Card>

        {canRunAgents ? (
          <AiPanel
            t={t}
            locale={locale}
            tz={tz}
            title={t("finance.manager.memo.title")}
            description={manager ? t("finance.manager.memo.scheduled", { name: manager.name }) : t("finance.manager.memo.hint")}
            configured={aiConfigured()}
            tasks={memos}
            actions={<AiButton url={`${base}/manager/memo`} label={t("finance.manager.memo.run")} />}
          />
        ) : (
          <Card>
            <CardHeader icon={<FileText />} title={t("finance.manager.memo.title")} />
            <CardBody>
              <Notice tone="info">{t("finance.manager.memo.noAgents")}</Notice>
            </CardBody>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader icon={<Scale />} title={t("finance.manager.variance.title")} description={t("finance.manager.variance.hint")} />
        <CardBody className="grid gap-3">
          {variance.length ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {variance.map((b) => (
                <li key={b.id} className={cn("grid gap-2 rounded-lg border p-3", b.status === "over" ? "border-danger/40" : b.status === "on_track" ? "" : "border-warning/40")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                    <Badge tone={STATUS_TONE[b.status]}>{t(`finance.manager.variance.status.${b.status}`)}</Badge>
                  </div>
                  <UsageBar pct={b.usedPct} />
                  <p className="text-sm">
                    {t("finance.manager.variance.line", { actual: money(b.actualMinor, b.currency), budget: money(b.budgetMinor, b.currency), elapsed: b.elapsedPct })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("finance.manager.variance.compare", { previous: money(b.previousMinor, b.currency), projected: money(b.projectedMinor, b.currency) })}
                  </p>
                  {b.drivers.length ? (
                    <div className="grid gap-1 text-xs">
                      <span className="font-medium text-muted-foreground">{t("finance.manager.variance.drivers")}</span>
                      <ul className="grid gap-0.5">
                        {b.drivers.map((d, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="min-w-0 flex-1 truncate">
                              {d.description}
                              {d.vendor ? ` · ${d.vendor}` : ""}
                            </span>
                            <span className="tabular-nums">{money(d.amountMinor, b.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("finance.manager.variance.empty")}{" "}
              <Link href={`/${locale}/finance/budgets`} className="font-medium text-primary hover:underline">
                {t("finance.manager.variance.setup")}
              </Link>
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={<Tags />} title={t("finance.manager.categories.title")} description={t("finance.manager.categories.hint", { count: suggestions.uncategorised })} />
        {suggestions.suggestions.length ? (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("finance.manager.categories.expense")}</Th>
                  <Th className="text-end">{t("finance.manager.categories.amount")}</Th>
                  <Th>{t("finance.manager.categories.suggested")}</Th>
                  <Th>{t("finance.manager.categories.why")}</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {suggestions.suggestions.map((s) => (
                  <Tr key={s.transactionId}>
                    <Td>
                      <Link href={`/${locale}/finance/transactions/${s.transactionId}`} className="font-medium hover:underline">
                        {s.description}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {s.date}
                        {s.vendor ? ` · ${s.vendor}` : ""}
                      </span>
                    </Td>
                    <Td className="text-end tabular-nums">{money(s.amountMinor, s.currency)}</Td>
                    <Td>
                      <Badge tone="accent">{s.categoryName}</Badge>
                    </Td>
                    <Td className="text-xs text-muted-foreground">{t(`finance.manager.categories.basis.${s.basis}`, { confidence: s.confidence, count: s.samples })}</Td>
                    <Td className="text-end">
                      {canManage ? (
                        <ActionButton url={`${base}/manager/category-suggestions/${s.transactionId}/apply`} body={{ categoryId: s.categoryId }}>
                          {t("finance.manager.categories.apply")}
                        </ActionButton>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <CardBody>
            <p className="text-sm text-muted-foreground">{suggestions.uncategorised ? t("finance.manager.categories.noConfident") : t("finance.manager.categories.allDone")}</p>
          </CardBody>
        )}
      </Card>
    </div>,
  );
}
