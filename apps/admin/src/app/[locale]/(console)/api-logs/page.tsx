import Link from "next/link";
import { Activity, Gauge as GaugeIcon, ListFilter, ShieldBan } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SourceNote } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { API_LOG_RETENTION_DAYS, apiLogSummary, rateLimitSummary, searchApiLogs } from "@/server/modules/admin/api-logs";
import { requireViewer } from "@/server/session";

const cls = (s: number) => `${Math.floor(s / 100)}xx`;

/** API request log (sampled) and rate-limit (429) events, with filters, keyset pages and request-id deep links. */
export default async function ApiLogsPage({ searchParams }: PageProps<"/[locale]/api-logs">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const view = sp(q.view) === "limits" ? "limits" : "requests";
  const params = { view: view === "limits" ? "limits" : undefined, range: sp(q.range), status: sp(q.status), app: sp(q.app), route: sp(q.route), org: sp(q.org), key: sp(q.key), requestId: sp(q.requestId) };
  const base = `/${locale}/api-logs`;
  const r = await guard(Promise.all([apiLogSummary(viewer.ctx, { range: params.range }), view === "requests" ? searchApiLogs(viewer.ctx, { ...params, cursor: sp(q.cursor) }) : null, rateLimitSummary(viewer.ctx, 14)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [s, logs, limits] = r.value;
  const errors = s.byStatus.filter((b) => b.cls === "5xx").reduce((n, b) => n + b.count, 0);
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader icon={<Activity />} title={t("admin.apiLogs.title")} description={t("admin.apiLogs.subtitle", { days: API_LOG_RETENTION_DAYS, rate: Math.round(s.sampleRate * 100) })} why={t("admin.apiLogs.why")} meta={<SourceNote source="api_request_logs · rate_limit_events" at={new Date()} label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} />} />
      {!s.tracking ? <Notice tone="info">{t("admin.apiLogs.notTrackedNotice")}</Notice> : null}
      <StatGrid>
        <StatTile icon={<ListFilter />} label={t("admin.apiLogs.stored")} value={n(s.total)} hint={t(`admin.apiLogs.ranges.${s.range}`)} />
        <StatTile label={t("admin.apiLogs.errors5xx")} value={n(errors)} tone={errors ? "danger" : undefined} href={`${base}?status=5xx`} />
        <StatTile icon={<GaugeIcon />} label={t("admin.apiLogs.latency")} value={s.p95 !== null ? `${s.p95} ms` : t("admin.settings.kit.noData")} hint={s.p50 !== null ? t("admin.apiLogs.p50", { ms: s.p50 }) : t("admin.apiLogs.sampleOnly")} />
        <StatTile icon={<ShieldBan />} label={t("admin.apiLogs.limited")} value={n(limits.total)} hint={t("admin.apiLogs.limitedHint")} href={`${base}?view=limits`} tone={limits.total ? "warning" : undefined} />
      </StatGrid>
      <Card>
        <QuickFilters base={base} name="view" value={params.view} params={{}} label={t("admin.apiLogs.views")} options={[{ value: "", label: t("admin.apiLogs.requests") }, { value: "limits", label: t("admin.apiLogs.rateLimits") }]} />
        {view === "limits" ? (
          limits.latest.length === 0 ? (
            <EmptyState icon={<ShieldBan />} title={t("admin.settings.kit.noEvents")} body={t("admin.apiLogs.noLimits")} />
          ) : (
            <>
              <div className="flex flex-wrap gap-2 px-4 py-2 text-xs">
                {limits.byRule.map((b) => (
                  <span key={b.rule} className="rounded-full border px-2 py-0.5 font-mono">
                    {b.rule} · {b.count}
                  </span>
                ))}
              </div>
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.apiLogs.rule")}</Th>
                    <Th>{t("admin.apiLogs.subject")}</Th>
                    <Th>{t("admin.apiLogs.limit")}</Th>
                    <Th>{t("admin.settings.kit.when")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {limits.latest.map((e) => (
                    <Tr key={e.id}>
                      <Td className="font-mono text-xs">{e.rule}</Td>
                      <Td className="font-mono text-[11px] text-muted-foreground">{e.userId ? <Link href={`/${locale}/users/${e.userId}`} className="hover:underline">{e.userId.slice(0, 8)}</Link> : e.keyHash.slice(0, 12)}</Td>
                      <Td className="text-xs">{e.limit ?? "—"}</Td>
                      <Td className="text-xs text-muted-foreground"><Timestamp value={e.createdAt} mode="relative" /></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </>
          )
        ) : logs ? (
          <>
            <FilterBar
              action={base}
              values={params}
              submitLabel={t("admin.settings.kit.apply")}
              filters={[
                { name: "range", label: t("admin.apiLogs.range"), options: (["1h", "24h", "7d", "14d"] as const).map((v) => ({ value: v, label: t(`admin.apiLogs.ranges.${v}`) })) },
                { name: "status", label: t("admin.apiLogs.status"), options: (["2xx", "3xx", "4xx", "429", "5xx"] as const).map((v) => ({ value: v, label: v })) },
                { name: "app", label: t("admin.apiLogs.app"), options: (["user", "admin"] as const).map((v) => ({ value: v, label: v })) },
              ]}
              extra={
                <>
                  <Input name="route" defaultValue={params.route} placeholder={t("admin.apiLogs.route")} aria-label={t("admin.apiLogs.route")} className="w-48" maxLength={200} />
                  <Input name="requestId" defaultValue={params.requestId} placeholder={t("admin.apiLogs.requestId")} aria-label={t("admin.apiLogs.requestId")} className="w-56 font-mono" maxLength={100} />
                  {params.org ? <input type="hidden" name="org" value={params.org} /> : null}
                  {params.key ? <input type="hidden" name="key" value={params.key} /> : null}
                </>
              }
            />
            {logs.data.length === 0 ? (
              <EmptyState icon={<Activity />} title={t("admin.apiLogs.empty")} body={s.tracking ? t("admin.common.tryOtherFilters") : t("admin.apiLogs.notTrackedYet")} />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.apiLogs.route")}</Th>
                    <Th>{t("admin.apiLogs.status")}</Th>
                    <Th>{t("admin.apiLogs.duration")}</Th>
                    <Th>{t("admin.settings.kit.organization")}</Th>
                    <Th>{t("admin.apiLogs.requestId")}</Th>
                    <Th>{t("admin.settings.kit.when")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {logs.data.map((l) => (
                    <Tr key={l.id}>
                      <Td className="font-mono text-xs">
                        {l.route} <span className="text-[10px] text-muted-foreground">{l.app}</span>
                        {l.apiKeyId ? (
                          <div>
                            <Link href={`/${locale}/developers/keys/${l.apiKeyId}`} className="text-[11px] text-primary hover:underline">{t("admin.apiLogs.viaKey")}</Link>
                          </div>
                        ) : null}
                      </Td>
                      <Td>
                        <StatusBadge domain="httpClass" value={cls(l.status)}>{String(l.status)}</StatusBadge>
                        {l.errorCode ? <div className="font-mono text-[10px] text-muted-foreground">{l.errorCode}</div> : null}
                      </Td>
                      <Td className="text-xs tabular-nums">{l.durationMs} ms</Td>
                      <Td className="text-xs">{l.organizationId ? <Link href={`/${locale}/organizations/${l.organizationId}`} className="hover:underline">{l.organizationName ?? l.organizationId.slice(0, 8)}</Link> : "—"}</Td>
                      <Td className="font-mono text-[11px]">
                        <span className="inline-flex items-center gap-1">
                          <Link href={`/${locale}/audit?requestId=${encodeURIComponent(l.requestId)}&scope=all`} className="hover:underline">{l.requestId.slice(0, 16)}…</Link>
                          <CopyButton value={l.requestId} />
                        </span>
                      </Td>
                      <Td className="text-xs text-muted-foreground"><Timestamp value={l.createdAt} mode="relative" /></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
            <NextPage base={base} params={params} cursor={logs.nextCursor} label={t("common.next")} />
          </>
        ) : null}
      </Card>
      {s.routes.length ? (
        <Card>
          <CardHeader title={t("admin.apiLogs.topRoutes")} description={t("admin.apiLogs.sampleOnly")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.apiLogs.route")}</Th>
                <Th>{t("admin.apiLogs.count")}</Th>
                <Th>{t("admin.apiLogs.errors5xx")}</Th>
                <Th>{t("admin.apiLogs.p95")}</Th>
              </Tr>
            </THead>
            <TBody>
              {s.routes.map((x) => (
                <Tr key={x.route}>
                  <Td className="font-mono text-xs"><Link href={`${base}?route=${encodeURIComponent(x.route)}`} className="hover:underline">{x.route}</Link></Td>
                  <Td className="text-xs tabular-nums">{n(x.count)}</Td>
                  <Td className="text-xs tabular-nums">{n(x.errors)}</Td>
                  <Td className="text-xs tabular-nums">{x.p95 !== null ? `${x.p95} ms` : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
