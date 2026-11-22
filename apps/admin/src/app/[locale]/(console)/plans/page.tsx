import Link from "next/link";
import { Layers } from "lucide-react";
import { AdminHeader, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { CreatePlanButton, CreatePromotionButton, PlanEditor, type PlanEditDTO } from "@/components/admin/plans/plan-manager";
import { Badge } from "@/components/ui/badge";
import { PromotionToggle } from "@/components/admin/billing/actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { canPlatform } from "@/server/modules/admin/access";
import { listCatalog } from "@/server/modules/pricing/service";
import { planRevenueSummary, searchOrganizations } from "@/server/modules/entitlements/admin";
import { PROVIDER_CATEGORIES } from "@/server/modules/integrations/catalog";
import { integrationCategoryAccess } from "@/server/modules/entitlements/catalog";
import { requireViewer } from "@/server/session";

const fmtMrr = (mrr: Record<string, bigint>, locale: string) =>
  Object.entries(mrr)
    .map(([currency, amountMinor]) => formatMoney({ amountMinor, currency }, locale))
    .join(" · ") || "—";

/** Plan & entitlement manager: plans, prices (versioned), limits / credit allocation, promotions, revenue & churn, org overrides. */
export default async function PlansManagerPage({ searchParams }: PageProps<"/[locale]/plans">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = sp((await searchParams).q);
  const [catalog, revenue] = await Promise.all([guard(listCatalog(viewer.ctx), t("errors.forbidden")), guard(planRevenueSummary(viewer.ctx), t("errors.forbidden"))]);
  if (!catalog.ok) return catalog.node;
  const canManage = await canPlatform(viewer.ctx, "pricing.manage");
  const [promotions, orgs, liveByPlan] = await Promise.all([
    db().promotion.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { coupons: true } }),
    q ? searchOrganizations(viewer.ctx, q).catch(() => []) : Promise.resolve([]),
    db().subscription.groupBy({ by: ["planId"], where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, _count: { _all: true } }),
  ]);
  const now = new Date();
  const plans: PlanEditDTO[] = catalog.value.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    status: p.status,
    public: p.public,
    defaultTrialDays: p.defaultTrialDays,
    liveSubscriptions: liveByPlan.find((l) => l.planId === p.id)?._count._all ?? 0,
    entitlements: p.entitlements.map((e) => ({ featureKey: e.featureKey, enabled: e.enabled, limitValue: e.limitValue?.toString() ?? null })),
    prices: p.prices.map((pr) => {
      const v = pr.versions.find((x) => x.effectiveFrom <= now && (!x.effectiveTo || x.effectiveTo > now)) ?? pr.versions[0] ?? null;
      return {
        id: pr.id,
        interval: pr.interval,
        marketType: pr.marketType,
        marketCode: pr.marketCode,
        currency: pr.currency,
        status: pr.status,
        current: v ? { version: v.version, amountMinor: v.amountMinor.toString(), trialDays: v.trialDays, effectiveFrom: v.effectiveFrom.toISOString() } : null,
      };
    }),
  }));
  const totals = revenue.ok ? revenue.value.plans.reduce((a, p) => ({ live: a.live + p.live, trialing: a.trialing + p.trialing, cancel: a.cancel + p.cancelScheduled }), { live: 0, trialing: 0, cancel: 0 }) : null;
  const allMrr: Record<string, bigint> = {};
  if (revenue.ok) for (const p of [...revenue.value.plans, ...revenue.value.others]) for (const [c, v] of Object.entries(p.mrr)) allMrr[c] = (allMrr[c] ?? 0n) + v;

  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Layers />}
        title={t("admin.plans.manager.title")}
        description={t("admin.plans.manager.subtitle")}
        why={t("admin.plans.manager.why")}
        actions={canManage ? <div className="flex gap-2"><CreatePromotionButton planKeys={plans.map((p) => p.key)} /><CreatePlanButton /></div> : null}
      />

      {revenue.ok && totals ? (
        <>
          <StatGrid>
            <StatTile label={t("admin.plans.manager.mrr")} value={fmtMrr(allMrr, locale)} />
            <StatTile label={t("admin.plans.manager.liveSubscriptions")} value={formatNumber(totals.live, locale)} hint={t("admin.plans.manager.trialing", { count: totals.trialing })} />
            <StatTile label={t("admin.plans.manager.cancelScheduled")} value={formatNumber(totals.cancel, locale)} tone={totals.cancel ? "warning" : undefined} />
            <StatTile
              label={t("admin.plans.manager.churn30")}
              value={revenue.value.churn30.rate === null ? "—" : formatNumber(revenue.value.churn30.rate, locale, { style: "percent", maximumFractionDigits: 1 })}
              hint={t("admin.plans.manager.churnHint", { canceled: revenue.value.churn30.canceled, base: revenue.value.churn30.base })}
              tone={revenue.value.churn30.rate !== null && revenue.value.churn30.rate > 0.05 ? "danger" : undefined}
            />
          </StatGrid>
          <Card>
            <CardHeader title={t("admin.plans.manager.revenueTitle")} />
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.plans.manager.plan")}</Th>
                  <Th>{t("admin.plans.manager.live")}</Th>
                  <Th>{t("admin.plans.manager.pastDue")}</Th>
                  <Th>{t("admin.plans.manager.cancelScheduled")}</Th>
                  <Th>{t("admin.plans.manager.churned30")}</Th>
                  <Th>{t("admin.plans.manager.mrr")}</Th>
                </Tr>
              </THead>
              <TBody>
                {[...revenue.value.plans.map((p) => ({ ...p, legacy: false })), ...revenue.value.others.map((p) => ({ ...p, name: p.key, legacy: true }))].map((p) => (
                  <Tr key={p.key}>
                    <Td>
                      {p.name} {p.legacy ? <Badge tone="neutral">{t("admin.plans.manager.legacy")}</Badge> : null}
                    </Td>
                    <Td className="tabular">{formatNumber(p.live, locale)}</Td>
                    <Td className="tabular">{formatNumber(p.pastDue, locale)}</Td>
                    <Td className="tabular">{formatNumber(p.cancelScheduled, locale)}</Td>
                    <Td className="tabular">{formatNumber(p.churned30, locale)}</Td>
                    <Td className="tabular">{fmtMrr(p.mrr, locale)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      ) : null}

      <Card>
        <CardHeader title={t("admin.plans.manager.orgTitle")} description={t("admin.plans.manager.orgHint")} />
        <CardBody className="grid gap-3">
          <form className="flex gap-2" action={`/${locale}/plans`}>
            <Input name="q" defaultValue={q ?? ""} placeholder={t("admin.plans.manager.orgSearch")} aria-label={t("admin.plans.manager.orgSearch")} />
          </form>
          {q && orgs.length === 0 ? <p className="text-sm text-muted-foreground">{t("admin.plans.manager.noOrgs")}</p> : null}
          <ul className="grid gap-1">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link href={`/${locale}/plans/organizations/${o.id}`} className="text-sm text-primary hover:underline">
                  {o.name} <span className="font-mono text-xs text-muted-foreground">{o.slug}</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {plans.map((p) => (
        <PlanEditor key={p.id} plan={p} canManage={canManage} />
      ))}

      <Card>
        <CardHeader title={t("admin.plans.manager.promotions")} />
        {promotions.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted-foreground">{t("admin.plans.manager.noPromotions")}</p>
          </CardBody>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.plans.manager.promoName")}</Th>
                <Th>{t("admin.plans.manager.discount")}</Th>
                <Th>{t("admin.plans.manager.couponCode")}</Th>
                <Th>{t("admin.plans.manager.appliesTo")}</Th>
                <Th>{t("admin.plans.manager.window")}</Th>
                <Th>{t("admin.plans.manager.status")}</Th>
              </Tr>
            </THead>
            <TBody>
              {promotions.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.name}</Td>
                  <Td className="tabular">
                    {p.discountType === "PERCENT" ? `${(p.percentOffBps ?? 0) / 100}%` : p.amountOffMinor !== null && p.currency ? formatMoney({ amountMinor: p.amountOffMinor, currency: p.currency }, locale) : "—"}
                  </Td>
                  <Td className="font-mono text-xs">
                    {p.coupons.map((c) => `${c.code} (${c.redemptions}${p.maxRedemptions ? `/${p.maxRedemptions}` : ""})`).join(", ") || "—"}
                  </Td>
                  <Td className="font-mono text-xs">{p.planKeys.join(", ") || t("admin.plans.manager.allPlans")}</Td>
                  <Td className="text-xs">
                    {formatDate(p.startsAt, locale, viewer.user.timezone)} – {p.endsAt ? formatDate(p.endsAt, locale, viewer.user.timezone) : "∞"}
                  </Td>
                  <Td>{canManage ? <PromotionToggle promotionId={p.id} active={p.status === "ACTIVE"} /> : <Badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status}</Badge>}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={t("admin.plans.manager.integrationAccess")} description={t("admin.plans.manager.integrationAccessHint")} />
        <CardBody>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {PROVIDER_CATEGORIES.map((c) => {
              const a = integrationCategoryAccess(c);
              return (
                <li key={c} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                  <span className="font-mono text-xs">{c}</span>
                  <span className="flex gap-1">
                    <Badge tone={a.minPlan === "starter" ? "success" : "info"}>{a.minPlan}+</Badge>
                    {a.countsAsChannel ? <Badge tone="neutral">{t("admin.plans.manager.channel")}</Badge> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
