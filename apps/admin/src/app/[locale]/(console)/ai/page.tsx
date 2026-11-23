import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import Link from "next/link";
import { Activity, Bot, BrainCircuit, Cpu, Gauge as GaugeIcon, Layers, PauseCircle, ShieldAlert, Sparkles, Timer, Wallet } from "lucide-react";
import { CardBody } from "@/components/ui/card";
import { CountUp } from "@/components/motion/count-up";
import { SystemPulse } from "@/components/motion/system-pulse";
import { AdminHeader, SectionLink, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { ControlListEditor, ControlSwitch, ControlValueEditor, KillSwitchCard, ListMemberToggle } from "@/components/admin/control-editors";
import { BarList, Sparkline, TrendChart } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { aiOverview } from "@/server/modules/admin/ai";
import { aiDailySeries } from "@/server/modules/admin/ai-trends";
import { aiRequestStats } from "@/server/modules/admin/ai-requests";
import { queueCounts } from "@/server/modules/admin/monitoring";
import { AI_PROVIDERS } from "@/server/modules/agents/providers/catalog";
import { Timestamp } from "@/components/admin/timestamp";
import { requireViewer } from "@/server/session";

/** AI Control Center: workforce, roles, models, budgets and policy across the platform. */
export default async function AdminAiPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([aiOverview(viewer.ctx), aiDailySeries(viewer.ctx, 30), aiRequestStats(viewer.ctx, { window: "24h" })]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, series, req] = r.value;
  const queues = (await queueCounts().catch(() => [])).filter((q) => /agent/i.test(q.name));
  const pct = (v: number | null) => (v === null ? t("admin.aiRequests.noData") : `${(v * 100).toFixed(1)}%`);
  const ms = (v: number | null) => (v === null ? t("admin.aiRequests.noData") : `${n(v)} ms`);
  const c = o.controls;
  const [canAi, canControls] = await Promise.all([canPlatform(viewer.ctx, "platform.ai.manage"), canPlatform(viewer.ctx, "platform.controls.manage")]);
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/ai`;
  const fmtBudget = (v: number | null) => (v === null ? t("admin.controls.unlimited") : n(v));
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<BrainCircuit />}
        title={t("admin.nav.ai")}
        description={t("admin.ai.subtitle")}
        why={t("admin.ai.why")}
        meta={<SystemPulse active={(o.tasks24h.RUNNING ?? 0) > 0} tone={(o.tasks24h.RUNNING ?? 0) > 0 ? "success" : "neutral"} label={t("admin.overview.workingNow", { count: o.tasks24h.RUNNING ?? 0 })} />}
      />
      <StatGrid>
        <StatTile
          icon={<Cpu />}
          label={t("admin.ai.provider")}
          value={o.provider.configured ? t("admin.system.configured") : t("admin.system.notConfigured")}
          tone={o.provider.configured ? "success" : "danger"}
          hint={<span className="font-mono">{o.provider.effectiveModel}</span>}
        />
        <StatTile icon={<Bot />} label={t("admin.overview.aiEmployees")} value={<CountUp value={o.employees.active} />} hint={t("admin.overview.paused", { count: n(o.employees.paused) })} />
        <StatTile
          icon={<Sparkles />}
          label={t("admin.ai.tasks24h")}
          value={<CountUp value={(o.tasks24h.RUNNING ?? 0) + (o.tasks24h.QUEUED ?? 0)} />}
          hint={t("admin.ai.tasks24hHint", { completed: n(o.tasks24h.COMPLETED ?? 0), failed: n(o.tasks24h.FAILED ?? 0) })}
          href={`${base}/tasks`}
          tone={o.tasks24h.FAILED ? "warning" : undefined}
          spark={<Sparkline values={series.tasks} label={t("admin.ai.seriesTasks")} />}
        />
        <StatTile
          icon={<PauseCircle />}
          label={t("admin.ai.tokensMonth")}
          value={<CountUp value={o.usage.month.tokens} format="compact" />}
          hint={`${usd(o.usage.month.costMicros, locale)} · ${t("admin.ai.today", { tokens: n(o.usage.today.tokens) })}`}
          href={`${base}/usage`}
          spark={<Sparkline values={series.costMicros} tone="warning" label={t("admin.ai.seriesCost")} />}
        />
      </StatGrid>
      <StatGrid>
        <StatTile icon={<Activity />} label={t("admin.aiRequests.requests24h")} value={<CountUp value={req.totals.total} />} hint={t("admin.aiRequests.requestsHint", { errors: n(req.totals.errors), fallbacks: n(req.totals.fallbacks), blocked: n(req.totals.blocked) })} href={`${base}/requests`} />
        <StatTile icon={<GaugeIcon />} label={t("admin.aiRequests.successRate")} value={pct(req.totals.successRate)} tone={req.totals.successRate !== null && req.totals.successRate < 0.95 ? "warning" : undefined} href={`${base}/requests?status=ERROR`} />
        <StatTile icon={<Timer />} label={t("admin.aiRequests.latency")} value={ms(req.totals.p50)} hint={t("admin.aiRequests.p95", { value: ms(req.totals.p95) })} href={`${base}/requests?minLatency=10000`} />
        <StatTile icon={<Wallet />} label={t("admin.aiRequests.cost24h")} value={usd(req.totals.costMicros, locale)} hint={t("admin.aiModels.tokens", { count: req.totals.tokens })} href={`${base}/budgets`} />
      </StatGrid>
      <p className="-mt-2 text-[11px] text-muted-foreground">
        {t("admin.aiRequests.source", { days: req.retentionDays })} · <Timestamp value={req.computedAt} mode="relative" />
      </p>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={<ShieldAlert />} title={t("admin.aiRequests.providerHealth")} description={t("admin.aiRequests.providerHealthHint")} actions={<SectionLink href={`${base}/requests`}>{t("admin.overview.viewAll")}</SectionLink>} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.aiModels.provider")}</Th>
                <Th>{t("admin.aiRequests.requests")}</Th>
                <Th>{t("admin.aiRequests.errorRate")}</Th>
                <Th>{t("admin.aiRequests.p50")}</Th>
                <Th>{t("admin.aiRequests.p95Short")}</Th>
                <Th>{t("admin.ai.columns.cost")}</Th>
              </Tr>
            </THead>
            <TBody>
              {AI_PROVIDERS.map((p) => {
                const s = req.byProvider.find((x) => x.key === p.key);
                return (
                  <Tr key={p.key}>
                    <Td>
                      <Link href={`${base}/providers/${p.key}`} className="font-medium hover:underline">
                        {p.label}
                      </Link>
                    </Td>
                    <Td className="tabular-nums">{s ? n(s.total) : "—"}</Td>
                    <Td className={s?.errorRate && s.errorRate > 0.05 ? "text-danger tabular-nums" : "tabular-nums"}>{s ? pct(s.errorRate) : t("admin.aiRequests.noData")}</Td>
                    <Td className="tabular-nums">{s ? ms(s.p50) : "—"}</Td>
                    <Td className="tabular-nums">{s ? ms(s.p95) : "—"}</Td>
                    <Td className="tabular-nums">{s ? usd(s.costMicros, locale) : "—"}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader icon={<Layers />} title={t("admin.aiRequests.modelDistribution")} description={t("admin.aiRequests.last24h")} />
          <CardBody>
            <BarList
              label={t("admin.aiRequests.modelDistribution")}
              items={req.byModel.slice(0, 8).map((m) => ({ key: m.key, label: <span className="font-mono text-xs">{m.key}</span>, value: m.total, display: n(m.total), href: `${base}/requests?model=${encodeURIComponent(m.key)}` }))}
              empty={<p className="text-xs text-muted-foreground">{t("admin.aiRequests.noRequests")}</p>}
            />
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.aiRequests.queues")} description={t("admin.aiRequests.queuesHint")} actions={<SectionLink href={`/${locale}/system/jobs`}>{t("admin.overview.viewAll")}</SectionLink>} />
          {queues.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{t("admin.aiRequests.queuesUnavailable")}</p>
          ) : (
            <Table>
              <TBody>
                {queues.map((q) => (
                  <Tr key={q.name}>
                    <Td className="font-mono text-xs">{q.name}</Td>
                    <Td className="text-xs">{q.available ? t("admin.aiRequests.queueCounts", { waiting: n(q.waiting), active: n(q.active), failed: n(q.failed) }) : t("admin.aiRequests.unavailable")}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.aiRequests.rateLimits")} description={t("admin.aiRequests.rateLimitsHint")} />
          <CardBody className="text-xs text-muted-foreground">
            {t("admin.aiRequests.rateLimitsBody", { count: n(req.byError.find((e) => e.key === "provider_unavailable")?.total ?? 0) })}{" "}
            <Link className="text-primary hover:underline" href={`${base}/requests?status=ERROR`}>
              {t("admin.overview.viewAll")}
            </Link>
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("admin.ai.usageChart")} description={t("admin.ai.usageChartHint")} actions={<SectionLink href={`${base}/usage`}>{t("admin.overview.viewAll")}</SectionLink>} />
          <CardBody className="grid gap-6">
            <TrendChart
              title={t("admin.ai.usageChart")}
              days={series.days}
              height={160}
              series={[
                { label: t("admin.ai.seriesTasks"), values: series.tasks, tone: "primary" },
                { label: t("admin.ai.seriesFailed"), values: series.failed, tone: "danger" },
              ]}
            />
            <TrendChart title={t("admin.ai.seriesCost")} days={series.days} height={120} series={[{ label: t("admin.ai.seriesCost"), values: series.costMicros, tone: "warning", format: "usdMicros" }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("admin.ai.costByModel")} description={t("admin.ai.last30")} />
          <CardBody>
            <BarList
              label={t("admin.ai.costByModel")}
              tone="warning"
              items={o.models.filter((m) => m.tasks30d > 0).sort((a, b) => b.costMicros30d - a.costMicros30d).slice(0, 8).map((m) => ({ key: m.id, label: <span className="font-mono text-xs">{m.id}</span>, value: m.costMicros30d, display: usd(m.costMicros30d, locale) }))}
              empty={<p className="text-xs text-muted-foreground">{t("admin.ai.noUsage")}</p>}
            />
          </CardBody>
        </Card>
      </div>
      <div className="stagger grid gap-3 md:grid-cols-2">
        <KillSwitchCard
          controlKey="aiWorkforceEnabled"
          value={c.aiWorkforceEnabled}
          normal
          critical
          canManage={canControls}
          locked={!!c.lockdown}
          icon={<Bot />}
          label={t("admin.controls.keys.aiWorkforceEnabled.label")}
          statusText={t(`admin.controls.cards.aiWorkforceEnabled.${c.aiWorkforceEnabled ? "normal" : "changed"}`)}
          consequence={t(`admin.controls.cards.aiWorkforceEnabled.${c.aiWorkforceEnabled ? "flip" : "restore"}`)}
        />
        <KillSwitchCard
          controlKey="aiExecutionPaused"
          value={c.aiExecutionPaused}
          normal={false}
          canManage={canControls}
          icon={<PauseCircle />}
          label={t("admin.controls.keys.aiExecutionPaused.label")}
          statusText={t(`admin.controls.cards.aiExecutionPaused.${c.aiExecutionPaused ? "changed" : "normal"}`)}
          consequence={t(`admin.controls.cards.aiExecutionPaused.${c.aiExecutionPaused ? "restore" : "flip"}`)}
        />
      </div>
      <Card>
        <CardHeader title={t("admin.ai.switches")} description={t("admin.ai.policyHint")} />
        <div className="divide-y">
          <ControlSwitch controlKey="aiRequireApprovalForWrites" value={c.aiRequireApprovalForWrites} normal={false} canManage={canAi} label={t("admin.controls.keys.aiRequireApprovalForWrites.label")} description={t("admin.controls.keys.aiRequireApprovalForWrites.hint")} />
          <ControlValueEditor
            controlKey="aiAutonomyCeiling"
            kind="select"
            value={c.aiAutonomyCeiling}
            canManage={canAi}
            label={t("admin.controls.keys.aiAutonomyCeiling.label")}
            description={t("admin.controls.keys.aiAutonomyCeiling.hint")}
            display={t(`admin.ai.ceiling.${c.aiAutonomyCeiling}`)}
            choices={(["full", "supervised", "read_only"] as const).map((v) => ({ value: v, label: t(`admin.ai.ceiling.${v}`) }))}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("admin.ai.budgets")} description={t("admin.ai.budgetsHint", { perCompany: o.provider.dailyTokenLimitPerCompany ? n(o.provider.dailyTokenLimitPerCompany) : t("admin.controls.unlimited") })} />
        <div className="divide-y">
          <ControlValueEditor controlKey="aiDailyTokenBudget" kind="number" value={c.aiDailyTokenBudget} display={fmtBudget(c.aiDailyTokenBudget)} canManage={canAi} label={t("admin.controls.keys.aiDailyTokenBudget.label")} description={t("admin.controls.keys.aiDailyTokenBudget.hint")} />
          <ControlValueEditor controlKey="aiMonthlyTokenBudget" kind="number" value={c.aiMonthlyTokenBudget} display={fmtBudget(c.aiMonthlyTokenBudget)} canManage={canAi} label={t("admin.controls.keys.aiMonthlyTokenBudget.label")} description={t("admin.controls.keys.aiMonthlyTokenBudget.hint")} />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("admin.ai.models")} description={t("admin.ai.modelsHint", { env: o.provider.envModel })} />
        <div className="divide-y border-b">
          <ControlValueEditor
            controlKey="aiDefaultModel"
            kind="nullableText"
            value={c.aiDefaultModel}
            canManage={canAi}
            label={t("admin.controls.keys.aiDefaultModel.label")}
            description={t("admin.controls.keys.aiDefaultModel.hint")}
            display={c.aiDefaultModel ?? t("admin.ai.envDefault", { model: o.provider.envModel })}
          />
          <ControlListEditor controlKey="aiAllowedModels" value={c.aiAllowedModels} options={o.models.map((m) => m.id)} allowCustom tone="accent" canManage={canAi} label={t("admin.controls.keys.aiAllowedModels.label")} description={t("admin.controls.keys.aiAllowedModels.hint")} />
        </div>
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.ai.columns.model")}</Th>
              <Th>{t("admin.ai.columns.tasks30")}</Th>
              <Th>{t("admin.ai.columns.tokens")}</Th>
              <Th>{t("admin.ai.columns.cost")}</Th>
              <Th>{t("admin.users.columns.status")}</Th>
            </Tr>
          </THead>
          <TBody>
            {o.models.map((m) => (
              <Tr key={m.id}>
                <Td className="font-mono text-xs">
                  {m.id}
                  {m.id === o.provider.effectiveModel ? <Badge className="ms-2" tone="accent">{t("admin.ai.inUse")}</Badge> : null}
                </Td>
                <Td className="tabular">{n(m.tasks30d)}</Td>
                <Td className="tabular">{n(m.tokens30d)}</Td>
                <Td className="tabular">{usd(m.costMicros30d, locale)}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    {!m.allowed ? <Badge tone="warning">{t("admin.ai.notAllowed")}</Badge> : null}
                    <ListMemberToggle controlKey="aiDisabledModels" list={c.aiDisabledModels} member={m.id} canManage={canAi} label={m.id} />
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader title={t("admin.ai.profiles")} description={t("admin.ai.profilesHint")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.ai.columns.profile")}</Th>
              <Th>{t("admin.ai.columns.department")}</Th>
              <Th>{t("admin.ai.columns.tools")}</Th>
              <Th>{t("admin.ai.columns.tasks30")}</Th>
              <Th>{t("admin.users.columns.status")}</Th>
            </Tr>
          </THead>
          <TBody>
            {o.profiles.map((p) => (
              <Tr key={p.key}>
                <Td>
                  <div className="flex items-center gap-2">
                    <StatusDot tone={p.disabled ? "danger" : "success"} />
                    <span>{t(`profiles.${p.key}.name`)}</span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{p.key}</div>
                </Td>
                <Td className="text-xs">{p.department}</Td>
                <Td className="tabular">{p.tools}</Td>
                <Td className="tabular">{n(p.tasks30d)}</Td>
                <Td>
                  <ListMemberToggle controlKey="aiDisabledProfiles" list={c.aiDisabledProfiles} member={p.key} canManage={canAi} label={p.key} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
