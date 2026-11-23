import Link from "next/link";
import { ArrowUpRight, Bell, BellRing, Layers, Scale } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, guard, NextPage, QuickFilters, sp, StatGrid, StatTile } from "@/components/admin/kit";
import { AutoRefresh } from "@/components/admin/viz";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { OpsAction } from "@/components/admin/ops/ops-action";
import { SourceLine } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { ALERT_MANAGE, ALERT_RULE_KEYS, ALERT_SEVERITIES, ALERT_STATUSES, alertEngineStatus, alertRulesCatalog, listAlerts } from "@/server/modules/admin/alerts";
import { requestTime, requireViewer } from "@/server/session";

/** Alert center: deduplicated, grouped alerts from the detection rules, with triage actions and the rule catalog. */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const status = ALERT_STATUSES.find((s) => s === sp(q.status));
  const severity = ALERT_SEVERITIES.find((s) => s === sp(q.severity));
  const rule = ALERT_RULE_KEYS.find((s) => s === sp(q.rule));
  const service = sp(q.service)?.match(/^[a-z.]{2,40}$/) ? sp(q.service) : undefined;
  const state = sp(q.state) === "all" ? "all" : "active";
  const text = sp(q.q);
  const cursor = sp(q.cursor);
  const r = await guard(listAlerts(viewer.ctx, { status, severity, rule, service, state, q: text, cursor: cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined, limit: 30 }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const page = r.value;
  const [canManage, engine] = await Promise.all([canPlatform(viewer.ctx, ALERT_MANAGE), alertEngineStatus()]);
  const catalog = alertRulesCatalog();
  const now = requestTime();
  const base = `/${locale}/alerts`;
  const params = { status, severity, rule, service, state, q: text };
  const engineStale = !engine.lastRunAt || now - engine.lastRunAt.getTime() > 16 * 60_000;
  const openIds = page.data.filter((a) => a.status === "OPEN").map((a) => a.id);
  const activeIds = page.data.filter((a) => a.status !== "RESOLVED").map((a) => a.id);
  const ruleLabel = (k: string) => t(`admin.alerts.rules.${k.replace(".", "_")}.title`);
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Bell />}
        title={t("admin.alerts.title")}
        description={t("admin.alerts.subtitle")}
        why={t("admin.alerts.why")}
        actions={<AutoRefresh loadedAt={now} timeZone={viewer.user.timezone} label={t("admin.live.on")} pausedLabel={t("admin.live.paused")} pauseLabel={t("admin.live.pause")} resumeLabel={t("admin.live.resume")} />}
      />
      {engineStale ? <Notice tone="warning" title={t("admin.alerts.engineStaleTitle")}>{t("admin.alerts.engineStaleBody")}</Notice> : null}
      <StatGrid>
        <StatTile label={t("admin.alerts.severity.CRITICAL")} value={formatNumber(page.activeBySeverity.CRITICAL, locale)} href={`${base}?severity=CRITICAL`} tone={page.activeBySeverity.CRITICAL ? "danger" : undefined} icon={<BellRing />} />
        <StatTile label={t("admin.alerts.severity.WARNING")} value={formatNumber(page.activeBySeverity.WARNING, locale)} href={`${base}?severity=WARNING`} tone={page.activeBySeverity.WARNING ? "warning" : undefined} />
        <StatTile label={t("admin.alerts.status.ACKNOWLEDGED")} value={formatNumber(page.counts.ACKNOWLEDGED, locale)} href={`${base}?status=ACKNOWLEDGED`} />
        <StatTile label={t("admin.alerts.status.SNOOZED")} value={formatNumber(page.counts.SNOOZED, locale)} href={`${base}?status=SNOOZED`} />
      </StatGrid>
      <SourceLine source={t("admin.alerts.source", { minutes: catalog.limits.intervalMinutes })} at={engine.lastRunAt} stale={engineStale} staleLabel={t("admin.system.hc.stale")} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader
            icon={<Bell />}
            title={t("admin.alerts.list")}
            actions={
              canManage && activeIds.length ? (
                <div className="flex flex-wrap gap-2">
                  {openIds.length ? <OpsAction label={t("admin.alerts.ackShown", { count: openIds.length })} title={t("admin.alerts.ackShown", { count: openIds.length })} path="/api/v1/admin/alerts" body={{ ids: openIds, action: "ack" }} success={t("admin.alerts.done")} /> : null}
                  <OpsAction label={t("admin.alerts.resolveShown", { count: activeIds.length })} title={t("admin.alerts.resolveShown", { count: activeIds.length })} description={t("admin.alerts.resolveShownHint")} path="/api/v1/admin/alerts" body={{ ids: activeIds, action: "resolve" }} success={t("admin.alerts.done")} />
                </div>
              ) : null
            }
          />
          <QuickFilters base={base} name="state" value={status ? undefined : state} params={{ severity, rule, service, q: text }} label={t("admin.alerts.filterState")} options={[{ value: "active", label: t("admin.alerts.state.active") }, { value: "all", label: t("admin.alerts.state.all") }]} />
          <FilterBar
            action={base}
            q={text}
            qLabel={t("admin.alerts.search")}
            values={params}
            submitLabel={t("admin.incidents.apply")}
            filters={[
              { name: "status", label: t("admin.alerts.fields.status"), options: ALERT_STATUSES.map((s) => ({ value: s, label: t(`admin.alerts.status.${s}`) })) },
              { name: "severity", label: t("admin.alerts.fields.severity"), options: ALERT_SEVERITIES.map((s) => ({ value: s, label: t(`admin.alerts.severity.${s}`) })) },
              { name: "rule", label: t("admin.alerts.fields.rule"), options: ALERT_RULE_KEYS.map((k) => ({ value: k, label: ruleLabel(k) })) },
            ]}
            extra={
              <Link href={base} className="self-center text-xs text-muted-foreground hover:underline">
                {t("admin.incidents.reset")}
              </Link>
            }
          />
          {page.data.length === 0 ? (
            <EmptyState icon={<Bell />} title={t("admin.alerts.empty")} body={t("admin.alerts.emptyHint")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.alerts.fields.title")}</Th>
                    <Th>{t("admin.alerts.fields.severity")}</Th>
                    <Th>{t("admin.alerts.fields.status")}</Th>
                    <Th className="text-end">{t("admin.alerts.fields.count")}</Th>
                    <Th>{t("admin.alerts.fields.lastSeen")}</Th>
                    <Th>{t("admin.alerts.fields.assignee")}</Th>
                    <Th>{t("admin.alerts.investigate")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {page.data.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <Link href={`${base}/${a.id}`} className="font-medium hover:underline">
                          {a.title}
                        </Link>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {a.rule}
                          {a.service ? ` · ${a.service}` : ""}
                          {a.escalationLevel ? ` · ${t("admin.alerts.escalatedLevel", { level: a.escalationLevel })}` : ""}
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge domain="alertSeverity" value={a.severity}>
                          {t(`admin.alerts.severity.${a.severity}`)}
                        </StatusBadge>
                      </Td>
                      <Td>
                        <StatusBadge domain="alert" value={a.status}>
                          {t(`admin.alerts.status.${a.status}`)}
                        </StatusBadge>
                      </Td>
                      <Td className="text-end tabular-nums">{formatNumber(a.count, locale)}</Td>
                      <Td className="text-xs">
                        <Timestamp value={a.lastSeenAt} mode="relative" />
                      </Td>
                      <Td className="text-xs">{a.assignee?.name ?? "—"}</Td>
                      <Td>
                        {a.investigate ? (
                          <Link href={`/${locale}${a.investigate.href}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                            {t(`admin.alerts.links.${a.investigate.key}`)}
                            <ArrowUpRight aria-hidden className="size-3 rtl:-scale-x-100" />
                          </Link>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
          <NextPage base={base} params={params} cursor={page.nextCursor} label={t("admin.system.jobs.next")} />
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<Layers />} title={t("admin.alerts.groups")} description={t("admin.alerts.groupsHint")} />
            {page.groups.length === 0 ? (
              <EmptyState title={t("admin.alerts.noGroups")} />
            ) : (
              <ul className="divide-y text-xs">
                {page.groups.map((g) => (
                  <li key={g.groupKey}>
                    <Link href={`${base}?rule=${encodeURIComponent(g.rule)}${g.service ? `&service=${encodeURIComponent(g.service)}` : ""}`} className="flex items-center gap-2 px-4 py-2 hover:bg-muted/50">
                      <span className="min-w-0 truncate">{ruleLabel(g.rule)}</span>
                      {g.service ? <span className="font-mono text-muted-foreground">{g.service}</span> : null}
                      <span className="ms-auto font-semibold tabular-nums">{g.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader icon={<Scale />} title={t("admin.alerts.rulesTitle")} description={t("admin.alerts.rulesHint")} />
            <ul className="divide-y text-xs">
              {catalog.rules.map((rl) => (
                <li key={rl.key} className="grid gap-0.5 px-4 py-2">
                  <span className="font-medium">{ruleLabel(rl.key)}</span>
                  <span className="text-muted-foreground">{rl.threshold}</span>
                  {rl.autoIncident ? <span className="text-info">{t("admin.alerts.autoIncident")}</span> : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title={t("admin.alerts.policyTitle")} description={t("admin.alerts.policyHint")} />
            <CardBody className="grid gap-2 text-xs">
              {ALERT_SEVERITIES.map((s) => (
                <div key={s} className="grid gap-0.5">
                  <StatusBadge domain="alertSeverity" value={s}>
                    {t(`admin.alerts.severity.${s}`)}
                  </StatusBadge>
                  <span className="text-muted-foreground">{t(`admin.alerts.policy.${s}`)}</span>
                </div>
              ))}
              <p className="text-muted-foreground">{t("admin.alerts.stormPolicy", { newPerRun: catalog.limits.maxNewPerRun, notifyPerRun: catalog.limits.maxNotificationsPerRun, renotify: catalog.limits.renotifyMinutes })}</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
