import Link from "next/link";
import { CreditCard, Download, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, guard, sp } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { DataSource, SubNav } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { PAYMENT_STATUSES, listPlatformPayments, mirrorStatus } from "@/server/modules/billing/explorers";
import { requireViewer } from "@/server/session";

/** Payment (charge) explorer over the Stripe mirror. */
export default async function PaymentsPage({ searchParams }: PageProps<"/[locale]/payments">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { q: sp(q.q), status: sp(q.status), org: sp(q.org), currency: sp(q.currency), from: sp(q.from), to: sp(q.to), limit: sp(q.limit) };
  const res = await guard(listPlatformPayments(viewer.ctx, { ...params, cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { page, byStatus } = res.value;
  const mirror = await mirrorStatus();
  const base = `/${locale}/payments`;
  const exportQs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const anyFilter = Object.entries(params).some(([k, v]) => k !== "limit" && !!v);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<CreditCard />}
        title={t("admin.payments.title")}
        description={t("admin.payments.subtitle")}
        why={t("admin.payments.why")}
        actions={
          <Button asChild size="sm" variant="secondary">
            <a href={`/api/v1/admin/payments/export?${exportQs}`}>
              <Download className="size-3.5" aria-hidden /> {t("admin.invoices.common.export")}
            </a>
          </Button>
        }
        meta={<DataSource source={t("admin.payments.source")} updatedAt={mirror.lastSyncedAt} updatedLabel={t("admin.invoices.common.lastSynced")} />}
      />
      <SubNav
        current="payments"
        items={[
          { key: "payments", href: base, label: t("admin.payments.title") },
          { key: "refunds", href: `${base}/refunds`, label: t("admin.payments.refunds.title") },
          { key: "disputes", href: `${base}/disputes`, label: t("admin.payments.disputes.title") },
        ]}
      />
      <Card>
        <QuickFilters
          base={base}
          name="status"
          value={params.status}
          params={params}
          label={t("admin.invoices.common.status")}
          options={[{ value: "", label: t("admin.invoices.common.all") }, ...PAYMENT_STATUSES.map((s) => ({ value: s, label: t(`admin.payments.status.${s}`), count: byStatus[s] ?? 0 }))]}
        />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.payments.search")}
          values={params}
          submitLabel={t("admin.invoices.common.apply")}
          filters={[
            { name: "status", label: t("admin.invoices.common.status"), options: PAYMENT_STATUSES.map((s) => ({ value: s, label: t(`admin.payments.status.${s}`) })) },
            { name: "limit", label: t("admin.invoices.common.pageSize"), options: ["25", "50", "100", "200"].map((n) => ({ value: n, label: n })) },
          ]}
          extra={
            <>
              <Input name="currency" defaultValue={params.currency} placeholder="EUR" maxLength={3} aria-label={t("admin.invoices.common.currency")} className="w-20 font-mono" />
              <Input name="from" type="date" defaultValue={params.from} aria-label={t("admin.invoices.common.from")} className="w-auto" />
              <Input name="to" type="date" defaultValue={params.to} aria-label={t("admin.invoices.common.to")} className="w-auto" />
              {params.org ? <input type="hidden" name="org" value={params.org} /> : null}
              {anyFilter ? (
                <Link href={base} className="text-xs text-primary hover:underline">
                  {t("admin.invoices.common.reset")}
                </Link>
              ) : null}
            </>
          }
        />
        {page.data.length === 0 ? (
          <EmptyState icon={<SearchX />} title={anyFilter ? t("common.noResults") : t("admin.payments.empty")} body={anyFilter ? undefined : t("admin.invoices.emptyHint")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.payments.charge")}</Th>
                <Th>{t("admin.invoices.common.organization")}</Th>
                <Th>{t("admin.invoices.common.status")}</Th>
                <Th>{t("admin.invoices.common.amount")}</Th>
                <Th>{t("admin.payments.method")}</Th>
                <Th>{t("admin.invoices.common.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {page.data.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`${base}/${p.id}`} className="font-mono text-xs font-medium hover:underline">
                      {p.stripeChargeId ?? p.stripePaymentIntentId ?? p.id}
                    </Link>
                    {!p.livemode ? <Badge tone="warning" className="ms-1.5">{t("admin.invoices.common.test")}</Badge> : null}
                  </Td>
                  <Td className="text-xs">
                    {p.organization ? (
                      <Link href={`${base}?org=${p.organizationId}`} className="hover:underline">
                        {p.organization.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{t("admin.invoices.common.unmatched")}</span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge domain="payment" value={p.status}>{t(`admin.payments.status.${p.status}`)}</StatusBadge>
                    {p.failureCode ? <div className="font-mono text-[11px] text-danger">{p.failureCode}</div> : null}
                  </Td>
                  <Td className="tabular text-xs">
                    {formatMoney({ amountMinor: p.amountMinor, currency: p.currency }, locale)}
                    {p.refundedMinor > 0n ? <div className="text-[11px] text-muted-foreground">−{formatMoney({ amountMinor: p.refundedMinor, currency: p.currency }, locale)}</div> : null}
                  </Td>
                  <Td className="text-xs">{p.paymentMethodBrand ? `${p.paymentMethodBrand} ···· ${p.last4 ?? ""}` : (p.paymentMethodType ?? "—")}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">
                    <Timestamp value={p.createdAt} mode="absolute" />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={page.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
