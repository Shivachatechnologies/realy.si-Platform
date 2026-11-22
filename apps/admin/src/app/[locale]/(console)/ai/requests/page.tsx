import Link from "next/link";
import { Activity, Download, Lock, SearchX, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, FilterBar, NextPage, QuickFilters, StatGrid, StatTile, guard, sp, usd } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { AI_REQUEST_STATUSES, aiRequestStats, getAiRequest, listAiRequests } from "@/server/modules/admin/ai-requests";
import { AI_PROVIDERS } from "@/server/modules/agents/providers/catalog";
import { ROUTING_TIERS } from "@/server/modules/admin/ai-models";
import { requireViewer } from "@/server/session";

/** AI request explorer: every model call attempt (metadata only), filters, keyset pages, detail panel, CSV. */
export default async function AdminAiRequestsPage({ searchParams }: PageProps<"/[locale]/ai/requests">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = {
    window: sp(q.window),
    org: sp(q.org),
    provider: sp(q.provider),
    model: sp(q.model),
    status: sp(q.status),
    tier: sp(q.tier),
    operation: sp(q.operation),
    task: sp(q.task),
    employee: sp(q.employee),
    trace: sp(q.trace),
    minLatency: sp(q.minLatency),
  };
  const id = sp(q.id);
  const r = await guard(Promise.all([listAiRequests(viewer.ctx, { ...params, cursor: sp(q.cursor), limit: sp(q.limit) }), aiRequestStats(viewer.ctx, { window: params.window }), id ? getAiRequest(viewer.ctx, id).catch(() => null) : Promise.resolve(null)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [list, stats, detail] = r.value;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.ai.manage", "platform.data.export"]);
  const canExport = caps["platform.ai.manage"] || caps["platform.data.export"];
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/ai/requests`;
  const keep = { ...params, window: list.filters.window };
  const qs = (extra: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ ...keep, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
    return s ? `?${s}` : "";
  };
  const active = Object.entries(params).some(([k, v]) => k !== "window" && !!v);
  const ms = (v: number | null) => (v === null ? "—" : `${n(v)} ms`);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<Activity />}
        title={t("admin.aiRequests.title")}
        description={t("admin.aiRequests.subtitle")}
        why={t("admin.aiRequests.why")}
        actions={
          canExport ? (
            <Button asChild size="sm" variant="secondary">
              <a href={`/api/v1/admin/ai/requests/export${qs({})}`} download>
                <Download />
                {t("admin.aiRequests.exportCsv")}
              </a>
            </Button>
          ) : null
        }
        meta={
          <span className="text-[11px] text-muted-foreground">
            {t("admin.aiRequests.source", { days: stats.retentionDays })} · <Timestamp value={stats.computedAt} mode="relative" />
          </span>
        }
      />
      <StatGrid>
        <StatTile label={t("admin.aiRequests.requests")} value={n(stats.totals.total)} hint={t("admin.aiRequests.windowLabel", { window: stats.window })} />
        <StatTile label={t("admin.aiRequests.successRate")} value={stats.totals.successRate === null ? t("admin.aiRequests.noData") : `${(stats.totals.successRate * 100).toFixed(1)}%`} href={`${base}${qs({ status: "ERROR" })}`} tone={stats.totals.errors ? "warning" : undefined} hint={t("admin.aiRequests.requestsHint", { errors: n(stats.totals.errors), fallbacks: n(stats.totals.fallbacks), blocked: n(stats.totals.blocked) })} />
        <StatTile label={t("admin.aiRequests.latency")} value={ms(stats.totals.p50)} hint={t("admin.aiRequests.p95", { value: ms(stats.totals.p95) })} />
        <StatTile label={t("admin.ai.columns.cost")} value={usd(stats.totals.costMicros, locale)} hint={t("admin.aiModels.tokens", { count: stats.totals.tokens })} />
      </StatGrid>
      {id ? (
        <Card className="border-primary/30">
          <CardHeader
            title={t("admin.aiRequests.detail")}
            description={detail ? `${detail.operation} · ${detail.servedModel ?? detail.requestedModel}` : t("admin.aiRequests.notFound")}
            actions={
              <Link href={`${base}${qs({ cursor: sp(q.cursor) })}`} aria-label={t("common.close")} className="rounded p-1 hover:bg-muted">
                <X className="size-4" />
              </Link>
            }
          />
          {detail ? (
            <>
              <Facts
                rows={[
                  [t("admin.aiRequests.id"), <CopyButton key="id" value={detail.id} showValue />],
                  [t("admin.aiRequests.time"), <Timestamp key="t" value={detail.createdAt} />],
                  [t("admin.ai.columns.status"), <StatusBadge key="s" domain="aiRequest" value={detail.status}>{t(`admin.aiRequests.status.${detail.status}`)}</StatusBadge>],
                  [t("admin.aiRequests.errorCode"), detail.errorCode ? <span className="font-mono text-danger">{detail.errorCode}</span> : "—"],
                  [t("admin.aiRequests.errorMessage"), detail.errorMessageHidden ? <span key="em" className="inline-flex items-center gap-1 text-muted-foreground"><Lock className="size-3" />{t("admin.aiRequests.sensitiveHidden")}</span> : (detail.errorMessage ?? "—")],
                  [t("admin.aiModels.provider"), <Link key="p" className="hover:underline" href={`/${locale}/ai/providers/${detail.provider}`}>{detail.provider}</Link>],
                  [t("admin.aiRequests.requestedModel"), <span key="rm" className="font-mono">{detail.requestedModel}</span>],
                  [t("admin.aiRequests.servedModel"), <span key="sm" className="font-mono">{detail.servedModel ?? "—"}</span>],
                  [t("admin.aiModels.tierLabel"), detail.tier ?? "—"],
                  [t("admin.aiRequests.attempt"), n(detail.attempt)],
                  [t("admin.aiRequests.latency"), ms(detail.latencyMs)],
                  [t("admin.ai.columns.tokens"), `${n(detail.inputTokens)} / ${n(detail.outputTokens)} (${t("admin.aiRequests.cached", { count: detail.cachedTokens })})`],
                  [t("admin.ai.columns.cost"), usd(detail.costMicros, locale)],
                  [t("admin.organizations.columns.name"), detail.organizationId ? <Link key="o" className="hover:underline" href={`/${locale}/organizations/${detail.organizationId}`}>{detail.organizationName ?? detail.organizationId}</Link> : t("admin.aiRequests.platformCall")],
                  [t("admin.aiRequests.task"), detail.task ? <Link key="tk" className="hover:underline" href={`/${locale}/ai/tasks/${detail.task.id}`}>{detail.task.title}</Link> : "—"],
                  [t("admin.aiWorkforce.employee"), detail.employee ? <Link key="e" className="hover:underline" href={`/${locale}/ai/workforce/${detail.employee.id}`}>{detail.employee.name}</Link> : "—"],
                  [t("admin.aiRequests.user"), detail.userHidden ? <span key="u" className="inline-flex items-center gap-1 text-muted-foreground"><Lock className="size-3" />{t("admin.aiRequests.sensitiveHidden")}</span> : detail.userId ? <Link key="u" className="hover:underline" href={`/${locale}/users/${detail.userId}`}>{detail.userId.slice(0, 8)}</Link> : "—"],
                  [t("admin.aiRequests.trace"), detail.traceId ? <Link key="tr" className="font-mono hover:underline" href={`${base}?trace=${encodeURIComponent(detail.traceId)}&window=30d`}>{detail.traceId}</Link> : "—"],
                ]}
              />
              <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("admin.aiRequests.noContent")}</p>
              {detail.siblings.length > 1 ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>{t("admin.aiRequests.attempt")}</Th>
                      <Th>{t("admin.aiRequests.servedModel")}</Th>
                      <Th>{t("admin.ai.columns.status")}</Th>
                      <Th>{t("admin.aiRequests.latency")}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {detail.siblings.map((s) => (
                      <Tr key={s.id}>
                        <Td className="tabular-nums">{s.attempt}</Td>
                        <Td className="font-mono text-xs">{s.servedModel ?? s.requestedModel}</Td>
                        <Td>
                          <StatusBadge domain="aiRequest" value={s.status}>{t(`admin.aiRequests.status.${s.status}`)}</StatusBadge>
                        </Td>
                        <Td className="tabular-nums text-xs">{ms(s.latencyMs)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}
      <Card>
        <QuickFilters
          base={base}
          name="window"
          value={list.filters.window}
          params={keep}
          label={t("admin.aiRequests.window")}
          options={(["1h", "24h", "7d", "30d"] as const).map((w) => ({ value: w, label: t(`admin.aiRequests.windows.${w}`) }))}
        />
        <FilterBar
          action={base}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "status", label: t("admin.ai.columns.status"), options: AI_REQUEST_STATUSES.map((s) => ({ value: s, label: t(`admin.aiRequests.status.${s}`) })) },
            { name: "provider", label: t("admin.aiModels.provider"), options: AI_PROVIDERS.map((p) => ({ value: p.key, label: p.label })) },
            { name: "model", label: t("admin.aiModels.model"), options: stats.byModel.map((m) => ({ value: m.key, label: m.key })) },
            { name: "tier", label: t("admin.aiModels.tierLabel"), options: ROUTING_TIERS.map((x) => ({ value: x, label: x })) },
            { name: "operation", label: t("admin.aiRequests.operation"), options: stats.byOperation.map((o) => ({ value: o.key, label: o.key })) },
            { name: "minLatency", label: t("admin.aiRequests.minLatency"), options: [1000, 5000, 10000, 30000].map((v) => ({ value: String(v), label: `≥ ${n(v)} ms` })) },
          ]}
          extra={
            <>
              <input type="hidden" name="window" value={list.filters.window} />
              {(["org", "task", "employee", "trace"] as const).map((k) => (params[k] ? <input key={k} type="hidden" name={k} value={params[k]} /> : null))}
              {active ? (
                <Button asChild variant="ghost">
                  <Link href={`${base}?window=${list.filters.window}`}>{t("admin.aiRequests.resetFilters")}</Link>
                </Button>
              ) : null}
            </>
          }
        />
        {list.data.length === 0 ? (
          <EmptyState icon={<SearchX />} title={t("admin.aiRequests.noRequests")} body={t("admin.aiRequests.noRequestsHint")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.aiRequests.time")}</Th>
                <Th>{t("admin.aiRequests.operation")}</Th>
                <Th>{t("admin.aiModels.model")}</Th>
                <Th>{t("admin.ai.columns.status")}</Th>
                <Th>{t("admin.aiRequests.latency")}</Th>
                <Th>{t("admin.ai.columns.tokens")}</Th>
                <Th>{t("admin.ai.columns.cost")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((row) => (
                <Tr key={row.id} aria-current={row.id === id ? "true" : undefined} className="aria-[current]:bg-accent/40">
                  <Td className="text-xs whitespace-nowrap">
                    <Link href={`${base}${qs({ id: row.id, cursor: sp(q.cursor) })}`} className="hover:underline">
                      <Timestamp value={row.createdAt} mode="relative" />
                    </Link>
                  </Td>
                  <Td className="text-xs">
                    <div className="font-mono">{row.operation}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.profile ?? "—"} · {row.tier ?? "—"}
                      {row.streamed ? ` · ${t("admin.aiRequests.streamed")}` : ""}
                    </div>
                  </Td>
                  <Td className="font-mono text-[11px]">
                    {row.servedModel ?? row.requestedModel}
                    {row.servedModel && row.servedModel !== row.requestedModel ? <div className="text-muted-foreground">← {row.requestedModel}</div> : null}
                  </Td>
                  <Td>
                    <StatusBadge domain="aiRequest" value={row.status}>{t(`admin.aiRequests.status.${row.status}`)}</StatusBadge>
                    {row.errorCode ? <div className="font-mono text-[11px] text-danger">{row.errorCode}</div> : null}
                    {row.attempt > 1 ? <Badge className="mt-0.5">{t("admin.aiRequests.attemptN", { n: row.attempt })}</Badge> : null}
                  </Td>
                  <Td className="text-xs tabular-nums">{ms(row.latencyMs)}</Td>
                  <Td className="text-xs tabular-nums">{n(row.inputTokens + row.outputTokens)}</Td>
                  <Td className="text-xs tabular-nums">{usd(row.costMicros, locale)}</Td>
                  <Td className="text-xs">
                    {row.organizationId ? (
                      <Link className="hover:underline" href={`${base}${qs({ org: row.organizationId })}`}>
                        {row.organizationName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{t("admin.aiRequests.platformCall")}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={keep} cursor={list.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
