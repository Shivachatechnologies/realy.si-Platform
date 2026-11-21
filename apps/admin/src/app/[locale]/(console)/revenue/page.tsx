import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CircleDollarSign, ExternalLink, Globe2, Layers, ReceiptText, TrendingUp, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, EmptyState, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { BarList } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { displayName, formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { revenueOverview } from "@/server/modules/admin/revenue";
import { requireViewer } from "@/server/session";

type MoneyList = { currency: string; amountMinor: bigint }[];

/** Revenue: MRR/ARR, movement (new / expansion / churn), by plan and country, Stripe invoices (real rows only). */
export default async function AdminRevenuePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(revenueOverview(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const money = (list: MoneyList) => (list.length ? list.map((m) => formatMoney({ amountMinor: m.amountMinor, currency: m.currency }, locale)).join(" · ") : "—");
  const first = (list: MoneyList) => (list[0] ? formatMoney({ amountMinor: list[0].amountMinor, currency: list[0].currency }, locale) : "—");
  const rest = (list: MoneyList) => (list.length > 1 ? list.slice(1).map((m) => formatMoney({ amountMinor: m.amountMinor, currency: m.currency }, locale)).join(" · ") : undefined);
  const maxMonth = Math.max(1, ...o.months.map((m) => Math.max(m.started, m.canceled)));
  const tz = viewer.user.timezone;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<TrendingUp />} title={t("admin.nav.revenue")} description={t("admin.revenue.subtitle")} why={t("admin.revenue.why")} />
      <StatGrid>
        <StatTile icon={<CircleDollarSign />} label={t("admin.revenue.mrr")} value={first(o.mrr)} hint={rest(o.mrr) ?? (o.mrr.length ? t("admin.revenue.mrrHint") : t("admin.overview.noMrr"))} tone={o.mrr.length ? "success" : undefined} />
        <StatTile icon={<Layers />} label={t("admin.revenue.arr")} value={first(o.arr)} hint={rest(o.arr) ?? t("admin.revenue.arrHint")} />
        <StatTile icon={<Users />} label={t("admin.revenue.paying")} value={formatNumber(o.paying, locale)} hint={t("admin.revenue.trialing", { count: o.trialing })} href={`/${locale}/subscriptions?status=ACTIVE`} />
        <StatTile
          icon={<ArrowDownRight />}
          label={t("admin.revenue.churnRate")}
          value={o.churnRate === null ? "—" : formatNumber(o.churnRate, locale, { style: "percent", maximumFractionDigits: 1 })}
          hint={t("admin.revenue.canceled30", { count: o.canceled30 })}
          tone={o.churnRate !== null && o.churnRate > 0.05 ? "warning" : undefined}
        />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-3">
        {(
          [
            ["newMrr", o.newMrr, "success", <ArrowUpRight key="i" />],
            ["expansionMrr", o.expansionMrr, "success", <TrendingUp key="i" />],
            ["churnedMrr", o.churnedMrr, "danger", <ArrowDownRight key="i" />],
          ] as const
        ).map(([key, list, tone, icon]) => (
          <Card key={key}>
            <CardHeader icon={icon} title={t(`admin.revenue.${key}`)} description={t(`admin.revenue.${key}Hint`)} />
            <CardBody>
              <p className={`text-xl font-semibold tabular-nums ${list.length ? (tone === "danger" ? "text-danger" : "text-success") : "text-muted-foreground"}`}>{money(list)}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Layers />} title={t("admin.revenue.byPlan")} description={t("admin.revenue.byPlanHint")} />
          <CardBody>
            <BarList
              label={t("admin.revenue.byPlan")}
              tone="success"
              items={o.byPlan.map((p) => ({ key: p.planId, label: p.name, value: p.subs, display: `${formatNumber(p.subs, locale)} · ${money(p.mrr)}`, href: `/${locale}/subscriptions?plan=${p.key}` }))}
              empty={<Empty>{t("admin.revenue.noPaying")}</Empty>}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Globe2 />} title={t("admin.revenue.byCountry")} description={t("admin.revenue.byCountryHint")} />
          <CardBody>
            <BarList
              label={t("admin.revenue.byCountry")}
              items={o.byCountry.slice(0, 15).map((c) => ({ key: c.country, label: `${displayName(c.country, "region", locale)} (${c.country})`, value: c.subs, display: `${formatNumber(c.subs, locale)} · ${money(c.mrr)}` }))}
              empty={<Empty>{t("admin.revenue.noPaying")}</Empty>}
            />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<TrendingUp />} title={t("admin.revenue.movement")} description={t("admin.revenue.movementHint")} />
        <CardBody>
          <div className="flex h-36 items-end gap-1.5" role="img" aria-label={t("admin.revenue.movement")}>
            {o.months.map((m) => (
              <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${m.month}: +${m.started} / −${m.canceled}`}>
                <div className="flex h-full w-full items-end justify-center gap-0.5">
                  <span className="w-1/2 max-w-3 rounded-t-sm bg-primary" style={{ height: `${(m.started / maxMonth) * 100}%` }} />
                  <span className="w-1/2 max-w-3 rounded-t-sm bg-danger/70" style={{ height: `${(m.canceled / maxMonth) * 100}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              {t("admin.revenue.started")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-danger/70" />
              {t("admin.revenue.canceled")}
            </span>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          icon={<ReceiptText />}
          title={t("admin.revenue.stripeInvoices")}
          description={o.stripe.connected ? t("admin.revenue.stripeConnected") : t("admin.revenue.stripeNotConnected")}
          actions={o.stripe.connected ? <Badge tone={"livemode" in o.stripe && o.stripe.livemode ? "success" : "warning"}>{"livemode" in o.stripe && o.stripe.livemode ? t("admin.revenue.live") : t("admin.revenue.test")}</Badge> : <Badge>{t("admin.revenue.notConnected")}</Badge>}
        />
        {o.stripe.error ? <div className="p-3"><Notice tone="danger">{t("admin.revenue.stripeError", { error: o.stripe.error })}</Notice></div> : null}
        {!o.stripe.connected ? (
          <EmptyState icon={<ReceiptText />} title={t("admin.revenue.stripeNotConnected")} body={t("admin.revenue.stripeSetup")} />
        ) : o.stripe.invoices.length === 0 ? (
          <Empty>{t("admin.revenue.noInvoices")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.revenue.invoice")}</Th>
                <Th>{t("admin.revenue.customer")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th>{t("admin.pricing.amount")}</Th>
                <Th>{t("admin.revenue.date")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.stripe.invoices.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-mono text-xs">
                    {i.hostedUrl ? (
                      <a href={i.hostedUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:underline">
                        {i.number ?? i.id.slice(0, 14)}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      (i.number ?? i.id.slice(0, 14))
                    )}
                  </Td>
                  <Td className="text-xs">{i.customerName ?? i.customerEmail ?? "—"}</Td>
                  <Td>
                    <Badge tone={i.status === "paid" ? "success" : i.status === "open" ? "warning" : i.status === "uncollectible" ? "danger" : "neutral"}>{i.status ?? "—"}</Badge>
                  </Td>
                  <Td className="text-xs tabular-nums">{formatMoney({ amountMinor: i.status === "paid" ? i.amountPaid : i.amountDue, currency: i.currency }, locale)}</Td>
                  <Td className="text-xs text-muted-foreground">{formatDate(i.created, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader icon={<ReceiptText />} title={t("admin.revenue.paymentEvents")} description={t("admin.revenue.paymentEventsHint")} />
        {o.events.length === 0 ? (
          <Empty>{t("admin.revenue.noEvents")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.revenue.event")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.revenue.outcome")}</Th>
                <Th>{t("admin.revenue.date")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.events.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <Badge tone={e.type === "invoice.payment_failed" ? "danger" : e.type.includes("paid") || e.type.includes("succeeded") ? "success" : "neutral"} className="font-mono">
                      {e.type}
                    </Badge>
                    {!e.livemode ? <span className="ms-1 text-[11px] text-muted-foreground">{t("admin.revenue.test")}</span> : null}
                  </Td>
                  <Td className="text-xs">
                    {e.organizationId ? (
                      <Link href={`/${locale}/organizations/${e.organizationId}`} className="hover:underline">
                        {e.organizationName ?? e.organizationId.slice(0, 8)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="font-mono text-[11px] text-muted-foreground">{e.outcome}</Td>
                  <Td className="text-xs text-muted-foreground">{formatDate(e.processedAt, locale, tz, { dateStyle: "medium", timeStyle: "short" })}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
