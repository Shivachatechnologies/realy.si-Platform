import Link from "next/link";
import { Building2, CircleDollarSign, Cpu, Layers, Server, Wallet } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { BarList, Gauge } from "@/components/admin/viz";
import { BudgetEditor, ModelToggle, OrgModelOverride, ProfileModelPicker, ProviderToggle } from "@/components/admin/ai-models-editor";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { adminCapabilities } from "@/server/modules/admin/access";
import { aiModelsOverview, aiRoutingOverview } from "@/server/modules/admin/ai-models";
import { TierRoutingToggle, TierRowEditor } from "@/components/admin/ai-tier-editor";
import { getControls } from "@/server/core/platform-controls";
import { aiRouting } from "@/server/modules/admin/ai-ops";
import { CreditEditor, FallbackChainEditor } from "@/components/admin/ai/ai-routing-editors";
import { requireViewer } from "@/server/session";

/** AI Control → Models & providers: provider switches, model catalog, defaults per profile class, org overrides, budget, cost. */
export default async function AdminAiModelsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([aiModelsOverview(viewer.ctx), adminCapabilities(viewer.ctx), getControls(), aiRouting(viewer.ctx), aiRoutingOverview(viewer.ctx)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, caps, controls, routing, tiers] = r.value;
  const canManage = caps["platform.ai.manage"];
  const enabledModels = o.models.filter((m) => !m.disabled && m.allowed).map((m) => m.id);
  const n = (v: number) => formatNumber(v, locale);
  const cap = o.budget.monthlyUsd;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Cpu />} title={t("admin.nav.aiModels")} description={t("admin.aiModels.subtitle")} why={t("admin.aiModels.why")} />
      <StatGrid>
        <StatTile icon={<Server />} label={t("admin.aiModels.providersEnabled")} value={`${o.providers.filter((p) => p.enabled).length}/${o.providers.length}`} />
        <StatTile icon={<Cpu />} label={t("admin.aiModels.modelsEnabled")} value={`${enabledModels.length}/${o.models.length}`} />
        <StatTile icon={<Layers />} label={t("admin.aiModels.platformDefault")} value={<span className="font-mono text-base">{o.platformDefault}</span>} href={`/${locale}/ai`} />
        <StatTile icon={<CircleDollarSign />} label={t("admin.aiModels.spentMonth")} value={usd(o.budget.spentMicros, locale)} hint={cap !== null ? t("admin.aiModels.ofCap", { cap: usd(cap * 1_000_000, locale) }) : t("admin.aiModels.noCap")} tone={cap !== null && o.budget.spentMicros >= cap * 1_000_000 ? "danger" : undefined} />
      </StatGrid>

      <Card>
        <CardHeader icon={<Server />} title={t("admin.aiModels.providers")} description={t("admin.aiModels.providersHint")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.aiModels.provider")}</Th>
              <Th>{t("admin.aiModels.credentials")}</Th>
              <Th>{t("admin.aiModels.models")}</Th>
              <Th>{t("admin.aiModels.cost30d")}</Th>
              <Th>{t("admin.users.columns.status")}</Th>
              <Th className="text-end">{t("admin.common.actions")}</Th>
            </Tr>
          </THead>
          <TBody>
            {o.providers.map((p) => (
              <Tr key={p.key}>
                <Td className="font-medium">{p.label}</Td>
                <Td>{p.configured ? <Badge tone="success">{t("admin.aiModels.configured")}</Badge> : <Badge tone="warning">{t("admin.aiModels.notConfigured")}</Badge>}</Td>
                <Td className="tabular-nums">{n(p.models)}</Td>
                <Td className="text-xs tabular-nums">
                  {usd(p.usage.costMicros, locale)} · {t("admin.aiModels.tokens", { count: p.usage.tokens })}
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <StatusDot tone={p.enabled ? "success" : "neutral"} />
                    {p.enabled ? t("admin.aiModels.enabled") : t("admin.aiModels.disabled")}
                  </span>
                </Td>
                <Td className="text-end">{p.models > 0 ? <ProviderToggle provider={p.key} label={p.label} enabled={p.enabled} canManage={canManage} /> : null}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<Cpu />} title={t("admin.aiModels.catalog")} description={t("admin.aiModels.catalogHint")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.aiModels.model")}</Th>
                <Th>{t("admin.aiModels.price")}</Th>
                <Th>{t("admin.aiModels.credits")}</Th>
                <Th>{t("admin.aiModels.cost30d")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.models.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <div className="font-mono text-xs">{m.id}</div>
                    <div className="text-[11px] text-muted-foreground">{m.provider}</div>
                  </Td>
                  <Td className="text-[11px] text-muted-foreground tabular-nums">{m.price ? `$${m.price.input} / $${m.price.output}` : "—"}</Td>
                  <Td>{canManage ? <CreditEditor model={m.id} current={routing.credits[m.id] ?? null} /> : <span className="font-mono text-[11px]">{routing.credits[m.id] ? `${routing.credits[m.id]!.input} / ${routing.credits[m.id]!.output}` : "—"}</span>}</Td>
                  <Td className="text-xs tabular-nums">{m.usage ? `${usd(m.usage.costMicros, locale)} · ${n(m.usage.tasks)}` : "—"}</Td>
                  <Td>
                    {m.id === o.platformDefault ? <Badge tone="accent">{t("admin.aiModels.default")}</Badge> : null}{" "}
                    {m.disabled ? <Badge tone="danger">{t("admin.aiModels.disabled")}</Badge> : !m.allowed ? <Badge tone="warning">{t("admin.aiModels.notAllowed")}</Badge> : <Badge tone="success">{t("admin.aiModels.enabled")}</Badge>}
                  </Td>
                  <Td className="text-end">
                    <ModelToggle model={m.id} disabled={m.disabled} disabledList={controls.aiDisabledModels} canManage={canManage} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<Wallet />} title={t("admin.aiModels.budget")} description={t("admin.aiModels.budgetCardHint")} actions={canManage ? <BudgetEditor current={cap} /> : null} />
            <CardBody className="grid gap-3">
              {cap !== null ? (
                <Gauge value={o.budget.spentMicros / 1_000_000} max={Math.max(cap, 0.01)} label={t("admin.aiModels.spentMonth")} display={usd(o.budget.spentMicros, locale)} sub={t("admin.aiModels.ofCap", { cap: usd(cap * 1_000_000, locale) })} tone={o.budget.spentMicros >= cap * 1_000_000 ? "danger" : "primary"} />
              ) : (
                <p className="text-xs text-muted-foreground">{t("admin.aiModels.noCapHint")}</p>
              )}
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">{t("admin.aiModels.tokenDaily")}</dt>
                  <dd className="tabular-nums">{o.budget.tokenDaily === null ? "—" : n(o.budget.tokenDaily)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("admin.aiModels.tokenMonthly")}</dt>
                  <dd className="tabular-nums">
                    {n(o.budget.tokensMonth)} / {o.budget.tokenMonthly === null ? "∞" : n(o.budget.tokenMonthly)}
                  </dd>
                </div>
              </dl>
              <Link href={`/${locale}/ai`} className="text-xs font-medium text-primary hover:underline">
                {t("admin.aiModels.tokenBudgetsLink")}
              </Link>
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Cpu />} title={t("admin.aiModels.fallbackChain")} description={t("admin.aiModels.fallbackHint")} actions={canManage ? <FallbackChainEditor chain={routing.fallbackChain} models={enabledModels} /> : null} />
            <CardBody>
              {routing.fallbackChain.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("admin.aiModels.noFallback")}</p>
              ) : (
                <ol className="flex flex-wrap items-center gap-1.5 text-xs">
                  <li className="rounded-md border border-primary/40 bg-accent px-2 py-0.5 font-mono">{o.platformDefault}</li>
                  {routing.fallbackChain.map((m) => (
                    <li key={m} className="flex items-center gap-1.5">
                      <span aria-hidden className="text-muted-foreground">→</span>
                      <span className="rounded-md border px-2 py-0.5 font-mono">{m}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Layers />} title={t("admin.aiModels.classDefaults")} description={t("admin.aiModels.classDefaultsHint")} />
            <ul className="divide-y">
              {o.profileClasses.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-3 px-4 py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium capitalize">{c.key.replace(/_/g, " ")}</span>
                    <span className="ms-2 text-xs text-muted-foreground">{t("admin.aiModels.profiles", { count: c.profiles })}</span>
                  </span>
                  <ProfileModelPicker profileClass={c.key} label={c.key.replace(/_/g, " ")} current={c.model} models={enabledModels} canManage={canManage} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<Layers />} title={t("admin.aiModels.tiers")} description={t("admin.aiModels.tiersHint")} actions={canManage ? <TierRoutingToggle enabled={tiers.table.enabled} /> : null} />
          {!tiers.table.enabled ? <p className="px-4 pt-2 text-xs text-warning">{t("admin.aiModels.tiersOff")}</p> : null}
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.aiModels.tierClass")}</Th>
                <Th>{t("admin.aiModels.tier.simple")}</Th>
                <Th>{t("admin.aiModels.tier.standard")}</Th>
                <Th>{t("admin.aiModels.tier.complex")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {tiers.classes.map((cls) => {
                const row = tiers.table.byClass[cls] ?? {};
                const eff = tiers.effective[cls]!;
                const label = cls === "*" ? t("admin.aiModels.tierAllClasses") : cls.replace(/_/g, " ");
                return (
                  <Tr key={cls}>
                    <Td className="font-medium capitalize">{label}</Td>
                    {(["simple", "standard", "complex"] as const).map((tier) => (
                      <Td key={tier}>
                        <div className="font-mono text-[11px]">{eff[tier] ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{row[tier] ? t("admin.aiModels.tierSet") : t("admin.aiModels.tierInherited")}</div>
                      </Td>
                    ))}
                    <Td className="text-end">{canManage ? <TierRowEditor profileClass={cls} label={label} current={row} models={enabledModels} /> : null}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader icon={<Server />} title={t("admin.aiModels.health")} description={t("admin.aiModels.healthHint")} />
          <ul className="divide-y">
            {tiers.providers.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{p.label}</span>
                  <span className="ms-2 font-mono text-[11px] text-muted-foreground">{p.envKey}</span>
                </span>
                <span className="flex items-center gap-2">
                  {p.configured ? <Badge tone="success">{t("admin.aiModels.configured")}</Badge> : <Badge tone="warning">{t("admin.aiModels.notConfigured")}</Badge>}
                  {p.openBreakers ? <Badge tone="danger">{t("admin.aiModels.breakersOpen", { count: p.openBreakers })}</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
          <CardBody>
            {tiers.breakers.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("admin.aiModels.noBreakers")}</p>
            ) : (
              <ul className="grid gap-1 text-xs">
                {tiers.breakers.map((b) => (
                  <li key={b.key} className="flex items-center justify-between gap-2">
                    <span className="font-mono">{b.model}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">{t("admin.aiModels.breakerFailures", { count: b.failures })}</span>
                      {b.open ? <Badge tone="danger">{t("admin.aiModels.breakerOpen")}</Badge> : <Badge tone="warning">{t("admin.aiModels.breakerDegraded")}</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Building2 />} title={t("admin.aiModels.orgOverrides")} description={t("admin.aiModels.overrideHint")} actions={canManage ? <OrgModelOverride models={enabledModels} /> : null} />
          {o.orgOverrides.length === 0 ? (
            <Empty>{t("admin.aiModels.noOverrides")}</Empty>
          ) : (
            <ul className="divide-y">
              {o.orgOverrides.map((x) => (
                <li key={x.organizationId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <Link href={`/${locale}/organizations/${x.organizationId}`} className="min-w-0 truncate font-medium hover:underline">
                    {x.name}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs">{x.model}</span>
                    {canManage ? <OrgModelOverride models={enabledModels} organizationId={x.organizationId} current={x.model} name={x.name} /> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<CircleDollarSign />} title={t("admin.aiModels.costByOrg")} description={t("admin.common.lastDays", { count: o.cost.days })} />
          <CardBody>
            <BarList
              label={t("admin.aiModels.costByOrg")}
              items={o.cost.byOrg.slice(0, 12).map((x) => ({ key: x.id, label: x.name, value: x.costMicros, display: usd(x.costMicros, locale), href: `/${locale}/organizations/${x.id}` }))}
              empty={<Empty>{t("admin.ai.noUsage")}</Empty>}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
