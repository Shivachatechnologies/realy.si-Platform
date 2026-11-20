import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { CircleDollarSign, Layers, ReceiptText, SearchX } from "lucide-react";
import { CardBody } from "@/components/ui/card";
import { CountUp } from "@/components/motion/count-up";
import { AdminHeader, EmptyState, FilterBar, NextPage, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { BarList, StackedBar } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { SUBSCRIPTION_STATUSES, subscriptionOverview } from "@/server/modules/admin/billing";
import { requireViewer } from "@/server/session";

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "accent"> = { ACTIVE: "success", TRIALING: "accent", PAST_DUE: "warning", UNPAID: "danger", CANCELED: "neutral" };

/** Subscription status overview: counts, MRR from real subscription items, filters. */
export default async function AdminSubscriptionsPage({ searchParams }: PageProps<"/[locale]/admin/subscriptions">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { q: sp(query.q), status: sp(query.status), plan: sp(query.plan), interval: sp(query.interval) };
  const r = await guard(subscriptionOverview(viewer.ctx, { ...params, cursor: sp(query.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const base = `/${locale}/admin/subscriptions`;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<ReceiptText />} title={t("admin.nav.subscriptions")} description={t("admin.subscriptions.subtitle")} why={t("admin.subscriptions.why")} />
      <StatGrid>
        <StatTile
          icon={<CircleDollarSign />}
          label={t("admin.overview.mrr")}
          value={o.mrr[0] ? <CountUp money={{ amountMinor: o.mrr[0].amountMinor.toString(), currency: o.mrr[0].currency }} /> : "—"}
          hint={o.mrr.length > 1 ? o.mrr.slice(1).map((m) => formatMoney({ amountMinor: m.amountMinor, currency: m.currency }, locale)).join(" · ") : o.mrr.length ? t("admin.subscriptions.mrrHint") : t("admin.overview.noMrr")}
          tone={o.mrr.length ? "success" : undefined}
        />
        {(["ACTIVE", "TRIALING", "PAST_DUE"] as const).map((s) => (
          <StatTile key={s} label={t(`admin.subscriptions.status.${s}`)} value={<CountUp value={o.byStatus[s] ?? 0} />} href={`${base}?status=${s}`} tone={s === "PAST_DUE" && o.byStatus[s] ? "warning" : undefined} />
        ))}
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Layers />} title={t("admin.subscriptions.distribution")} description={t("admin.subscriptions.distributionHint")} />
          <CardBody>
            <StackedBar
              label={t("admin.subscriptions.distribution")}
              segments={(["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID", "CANCELED"] as const).map((s) => ({
                key: s,
                label: t(`admin.subscriptions.status.${s}`),
                value: o.byStatus[s] ?? 0,
                tone: s === "ACTIVE" ? "success" : s === "TRIALING" ? "info" : s === "PAST_DUE" ? "warning" : s === "UNPAID" ? "danger" : "muted",
                href: `${base}?status=${s}`,
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<ReceiptText />} title={t("admin.subscriptions.byPlan")} />
          <CardBody>
            <BarList
              label={t("admin.subscriptions.byPlan")}
              tone="success"
              items={o.byPlan.map((p) => ({ key: p.id, label: p.name, value: p.live, href: `${base}?plan=${p.key}` }))}
              empty={<p className="text-xs text-muted-foreground">{t("admin.overview.noMrr")}</p>}
            />
          </CardBody>
        </Card>
      </div>
      <Card>
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.organizations.search")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "status", label: t("admin.users.filters.status"), options: SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: t(`admin.subscriptions.status.${s}`) })) },
            { name: "plan", label: t("admin.subscriptions.plan"), options: o.plans.map((p) => ({ value: p.key, label: p.name })) },
            { name: "interval", label: t("admin.pricing.interval"), options: (["MONTH", "YEAR"] as const).map((i) => ({ value: i, label: t(`admin.subscriptions.interval.${i}`) })) },
          ]}
        />
        {o.page.data.length === 0 ? (
          <EmptyState icon={<SearchX />} title={t("common.noResults")} body={t("admin.subscriptions.emptyHint")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.subscriptions.plan")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th>{t("admin.pricing.amount")}</Th>
                <Th>{t("admin.subscriptions.periodEnd")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.page.data.map((s) => {
                const total = s.items.reduce((a, i) => a + i.unitAmountMinor * BigInt(i.quantity), 0n);
                return (
                  <Tr key={s.id}>
                    <Td>
                      <Link href={`/${locale}/admin/organizations/${s.organization.id}`} className="font-medium hover:underline">
                        {s.organization.name}
                      </Link>
                      <div className="font-mono text-[11px] text-muted-foreground">{s.billingCountryCode}</div>
                    </Td>
                    <Td className="text-xs">
                      {s.plan.name} · {t(`admin.subscriptions.interval.${s.interval}`)}
                    </Td>
                    <Td>
                      <Badge tone={TONE[s.status] ?? "neutral"}>{t(`admin.subscriptions.status.${s.status}`)}</Badge>
                      {s.cancelAtPeriodEnd ? <div className="text-[11px] text-warning">{t("admin.subscriptions.cancelsAtEnd")}</div> : null}
                    </Td>
                    <Td className="tabular text-xs">{s.items.length ? formatMoney({ amountMinor: total, currency: s.currency }, locale) : "—"}</Td>
                    <Td className="text-xs whitespace-nowrap text-muted-foreground">
                      {s.trialEndsAt && s.status === "TRIALING" ? t("admin.subscriptions.trialEnds", { date: formatDate(s.trialEndsAt, locale, viewer.user.timezone) }) : s.currentPeriodEnd ? formatDate(s.currentPeriodEnd, locale, viewer.user.timezone) : "—"}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={o.page.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
