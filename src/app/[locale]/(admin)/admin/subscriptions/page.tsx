import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, FilterBar, NextPage, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
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
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.subscriptions")} description={t("admin.subscriptions.subtitle")} />
      <StatGrid>
        <StatTile label={t("admin.overview.mrr")} value={o.mrr.length ? o.mrr.map((m) => formatMoney({ amountMinor: m.amountMinor, currency: m.currency }, locale)).join(" · ") : "—"} hint={o.mrr.length ? undefined : t("admin.overview.noMrr")} />
        {(["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED"] as const).map((s) => (
          <StatTile key={s} label={t(`admin.subscriptions.status.${s}`)} value={n(o.byStatus[s] ?? 0)} href={`${base}?status=${s}`} tone={s === "PAST_DUE" && o.byStatus[s] ? "warning" : undefined} />
        ))}
      </StatGrid>
      <Card>
        <CardHeader title={t("admin.subscriptions.byPlan")} />
        <div className="flex flex-wrap gap-2 p-3">
          {o.byPlan.map((p) => (
            <Link key={p.id} href={`${base}?plan=${p.key}`} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
              {p.name} <span className="tabular font-medium">{n(p.live)}</span>
            </Link>
          ))}
        </div>
      </Card>
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
          <Empty>{t("common.noResults")}</Empty>
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
