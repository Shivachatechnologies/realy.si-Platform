import Link from "next/link";
import { Bot, OctagonAlert, PauseCircle, PiggyBank, TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, SectionLink, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { KillSwitchCard } from "@/components/admin/control-editors";
import { BudgetRuleEditor, DeleteBudgetRule, TenantBudgetEditor } from "@/components/admin/ai/ai-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { getControls } from "@/server/core/platform-controls";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { aiBudgetsOverview } from "@/server/modules/admin/ai-budgets";
import { aiModelsOverview } from "@/server/modules/admin/ai-models";
import { AI_PROVIDER_KEYS } from "@/server/modules/agents/providers/catalog";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { requireViewer } from "@/server/session";

/** Cost-control center: platform AI budgets (soft / hard, daily / monthly), projections, anomalies, tenant budgets, stop AI. */
export default async function AdminAiBudgetsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([aiBudgetsOverview(viewer.ctx), aiModelsOverview(viewer.ctx)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [b, models] = r.value;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.ai.manage", "platform.controls.manage"]);
  const c = await getControls();
  const n = (v: number) => formatNumber(v, locale);
  const legacyCap = models.budget.monthlyUsd;
  const blocked = b.rules.filter((x) => x.state === "blocked").length;
  const soft = b.rules.filter((x) => x.state === "soft" || x.state === "over").length;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<PiggyBank />}
        title={t("admin.aiBudgets.title")}
        description={t("admin.aiBudgets.subtitle")}
        why={t("admin.aiBudgets.why")}
        actions={caps["platform.ai.manage"] ? <BudgetRuleEditor providers={[...AI_PROVIDER_KEYS]} models={Object.keys(MODEL_PRICES)} /> : null}
        meta={
          <span className="text-[11px] text-muted-foreground">
            {t("admin.aiBudgets.source")} · <Timestamp value={b.computedAt} mode="relative" />
          </span>
        }
      />
      {blocked ? <Notice tone="danger" title={t("admin.aiBudgets.blockedTitle", { count: blocked })}>{t("admin.aiBudgets.blockedBody")}</Notice> : null}
      <StatGrid>
        <StatTile icon={<Wallet />} label={t("admin.aiBudgets.monthToDate")} value={usd(b.month.spentMicros, locale)} hint={legacyCap !== null ? t("admin.aiBudgets.legacyCap", { cap: usd(legacyCap * 1_000_000, locale) }) : undefined} href={`/${locale}/ai/usage`} />
        <StatTile icon={<TrendingUp />} label={t("admin.aiBudgets.projectedMonth")} value={b.month.projectedMicros === null ? t("admin.aiRequests.noData") : usd(b.month.projectedMicros, locale)} hint={t("admin.aiBudgets.projectionHint")} />
        <StatTile icon={<Wallet />} label={t("admin.aiBudgets.today")} value={usd(b.today.spentMicros, locale)} hint={b.today.projectedMicros === null ? undefined : t("admin.aiBudgets.projectedDay", { value: usd(b.today.projectedMicros, locale) })} />
        <StatTile icon={<OctagonAlert />} label={t("admin.aiBudgets.atRisk")} value={n(blocked + soft)} tone={blocked ? "danger" : soft ? "warning" : undefined} hint={t("admin.aiBudgets.atRiskHint", { blocked: n(blocked), soft: n(soft) })} />
      </StatGrid>
      <Card>
        <CardHeader title={t("admin.aiBudgets.rules")} description={t("admin.aiBudgets.rulesHint")} />
        {b.rules.length === 0 ? (
          <EmptyState icon={<PiggyBank />} title={t("admin.aiBudgets.noRules")} body={t("admin.aiBudgets.noRulesHint")} action={caps["platform.ai.manage"] ? <BudgetRuleEditor providers={[...AI_PROVIDER_KEYS]} models={Object.keys(MODEL_PRICES)} /> : undefined} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.aiBudgets.scope")}</Th>
                <Th>{t("admin.aiBudgets.period")}</Th>
                <Th>{t("admin.aiBudgets.spent")}</Th>
                <Th>{t("admin.aiBudgets.limit")}</Th>
                <Th>{t("admin.aiBudgets.projected")}</Th>
                <Th>{t("admin.ai.columns.status")}</Th>
                {caps["platform.ai.manage"] ? <Th className="text-end">{t("admin.common.actions")}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {b.rules.map((x) => (
                <Tr key={x.id}>
                  <Td>
                    <div className="text-sm font-medium">{t(`admin.aiBudgets.levels.${x.level}`)}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{x.level === "organization" ? <Link className="hover:underline" href={`/${locale}/organizations/${x.key}`}>{x.keyLabel}</Link> : x.level === "agent" ? <Link className="hover:underline" href={`/${locale}/ai/workforce/${x.key}`}>{x.key}</Link> : x.keyLabel}</div>
                    {x.note ? <div className="text-[11px] text-muted-foreground">{x.note}</div> : null}
                  </Td>
                  <Td className="text-xs">{t(`admin.aiBudgets.${x.period}`)}</Td>
                  <Td className="text-xs tabular-nums">
                    {usd(x.spentMicros, locale)} <span className="text-muted-foreground">({Math.round(x.pct * 100)}%)</span>
                    <div aria-hidden className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-muted">
                      <div className={x.pct >= 1 ? "h-full bg-danger" : x.pct * 100 >= x.softPct ? "h-full bg-warning" : "h-full bg-primary"} style={{ width: `${Math.min(100, Math.round(x.pct * 100))}%` }} />
                    </div>
                  </Td>
                  <Td className="text-xs tabular-nums">
                    {usd(x.limitMicros, locale)}
                    <div className="text-[11px] text-muted-foreground">
                      {x.hard ? t("admin.aiBudgets.hardShort") : t("admin.aiBudgets.softOnly")} · {t("admin.aiBudgets.softAt", { pct: x.softPct })}
                    </div>
                  </Td>
                  <Td className="text-xs tabular-nums">{x.projectedMicros === null ? "—" : usd(x.projectedMicros, locale)}</Td>
                  <Td>
                    <StatusBadge domain="aiBudget" value={x.state}>{t(`admin.aiBudgets.states.${x.state}`)}</StatusBadge>
                  </Td>
                  {caps["platform.ai.manage"] ? (
                    <Td className="text-end">
                      <div className="flex justify-end gap-1">
                        <BudgetRuleEditor rule={x} providers={[...AI_PROVIDER_KEYS]} models={Object.keys(MODEL_PRICES)} />
                        <DeleteBudgetRule id={x.id} />
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.aiBudgets.stopAi")} description={t("admin.aiBudgets.stopAiHint")} actions={<SectionLink href={`/${locale}/controls`}>{t("admin.nav.controls")}</SectionLink>} />
        <div className="grid gap-3 p-3 md:grid-cols-2">
          <KillSwitchCard
            controlKey="aiExecutionPaused"
            value={c.aiExecutionPaused}
            normal={false}
            canManage={caps["platform.controls.manage"]}
            icon={<PauseCircle />}
            label={t("admin.controls.keys.aiExecutionPaused.label")}
            statusText={t(`admin.controls.cards.aiExecutionPaused.${c.aiExecutionPaused ? "changed" : "normal"}`)}
            consequence={t(`admin.controls.cards.aiExecutionPaused.${c.aiExecutionPaused ? "restore" : "flip"}`)}
          />
          <KillSwitchCard
            controlKey="aiWorkforceEnabled"
            value={c.aiWorkforceEnabled}
            normal
            critical
            canManage={caps["platform.controls.manage"]}
            locked={!!c.lockdown}
            icon={<Bot />}
            label={t("admin.controls.keys.aiWorkforceEnabled.label")}
            statusText={t(`admin.controls.cards.aiWorkforceEnabled.${c.aiWorkforceEnabled ? "normal" : "changed"}`)}
            consequence={t(`admin.controls.cards.aiWorkforceEnabled.${c.aiWorkforceEnabled ? "flip" : "restore"}`)}
          />
        </div>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("admin.aiBudgets.stopAiFoot", { daily: b.stopped.tokenDaily === null ? t("admin.controls.unlimited") : n(b.stopped.tokenDaily), monthly: b.stopped.tokenMonthly === null ? t("admin.controls.unlimited") : n(b.stopped.tokenMonthly) })}</p>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<OctagonAlert />} title={t("admin.aiBudgets.anomalies")} description={t("admin.aiBudgets.anomaliesHint")} />
          {b.anomalies.length === 0 ? (
            <EmptyState title={t("admin.aiBudgets.noAnomalies")} />
          ) : (
            <Table>
              <TBody>
                {b.anomalies.map((a) => (
                  <Tr key={`${a.organizationId}:${a.day}`}>
                    <Td>
                      <Link className="font-medium hover:underline" href={`/${locale}/organizations/${a.organizationId}`}>
                        {a.organizationName}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">{a.day}</div>
                    </Td>
                    <Td className="text-xs tabular-nums">{usd(a.micros, locale)}</Td>
                    <Td className="text-xs tabular-nums">
                      <Badge tone="warning">{a.ratio === null ? t("admin.aiBudgets.newSpend") : `${a.ratio.toFixed(1)}×`}</Badge> <span className="text-muted-foreground">{t("admin.aiBudgets.baseline", { value: usd(a.baselineMicros, locale) })}</span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.aiBudgets.tenantBudgets")} description={t("admin.aiBudgets.tenantBudgetsHint")} />
          {b.tenantBudgets.length === 0 ? (
            <EmptyState title={t("admin.aiBudgets.noTenantBudgets")} />
          ) : (
            <Table>
              <TBody>
                {b.tenantBudgets.map((x) => (
                  <Tr key={x.id}>
                    <Td className="text-xs">
                      <Link className="font-medium hover:underline" href={`/${locale}/organizations/${x.organizationId}`}>
                        {x.organizationName}
                      </Link>
                      <div className="text-muted-foreground">
                        {x.companyName} · {x.scope}
                        {x.scopeKey !== "*" ? ` · ${x.scopeKey}` : ""}
                      </div>
                    </Td>
                    <Td className="text-xs tabular-nums">
                      {x.spentMicros === null ? t("admin.aiBudgets.perTask") : usd(x.spentMicros, locale)} / {usd(x.limitMicros, locale)}
                      <div className="text-[11px] text-muted-foreground">{x.hardStop ? t("admin.aiBudgets.hardShort") : t("admin.aiBudgets.softOnly")}</div>
                    </Td>
                    {caps["platform.ai.manage"] ? (
                      <Td className="text-end">
                        <TenantBudgetEditor budget={{ id: x.id, limitMicros: x.limitMicros, hardStop: x.hardStop, label: `${x.organizationName} · ${x.scope}` }} />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
