import Link from "next/link";
import { SearchX, Undo2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, guard, sp } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SubNav } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { REFUND_STATUSES, listPlatformRefunds } from "@/server/modules/billing/explorers";
import { requireViewer } from "@/server/session";

/** Refund explorer: every refund Stripe reported, including those issued outside the console. */
export default async function RefundsPage({ searchParams }: PageProps<"/[locale]/payments/refunds">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { q: sp(q.q), status: sp(q.status), org: sp(q.org), source: sp(q.source), limit: sp(q.limit) };
  const res = await guard(listPlatformRefunds(viewer.ctx, { ...params, cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { page } = res.value;
  const base = `/${locale}/payments`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: t("admin.payments.refunds.title") }]} />
      <AdminHeader icon={<Undo2 />} title={t("admin.payments.refunds.title")} description={t("admin.payments.refunds.subtitle")} />
      <SubNav
        current="refunds"
        items={[
          { key: "payments", href: base, label: t("admin.payments.title") },
          { key: "refunds", href: `${base}/refunds`, label: t("admin.payments.refunds.title") },
          { key: "disputes", href: `${base}/disputes`, label: t("admin.payments.disputes.title") },
        ]}
      />
      <Card>
        <QuickFilters
          base={`${base}/refunds`}
          name="source"
          value={params.source}
          params={params}
          label={t("admin.payments.refunds.source")}
          options={[
            { value: "", label: t("admin.invoices.common.all") },
            { value: "console", label: t("admin.payments.refunds.console") },
            { value: "external", label: t("admin.payments.refunds.external") },
          ]}
        />
        <FilterBar
          action={`${base}/refunds`}
          q={params.q}
          qLabel={t("admin.payments.refunds.search")}
          values={params}
          submitLabel={t("admin.invoices.common.apply")}
          filters={[
            { name: "status", label: t("admin.invoices.common.status"), options: REFUND_STATUSES.map((s) => ({ value: s, label: t(`admin.payments.refunds.status.${s}`) })) },
            { name: "limit", label: t("admin.invoices.common.pageSize"), options: ["25", "50", "100", "200"].map((n) => ({ value: n, label: n })) },
          ]}
        />
        {page.data.length === 0 ? (
          <EmptyState icon={<SearchX />} title={t("admin.payments.refunds.none")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.payments.refunds.id")}</Th>
                <Th>{t("admin.invoices.common.organization")}</Th>
                <Th>{t("admin.invoices.common.status")}</Th>
                <Th>{t("admin.invoices.common.amount")}</Th>
                <Th>{t("admin.payments.refunds.source")}</Th>
                <Th>{t("admin.invoices.common.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {page.data.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    {r.paymentId ? (
                      <Link href={`${base}/${r.paymentId}`} className="font-mono text-xs hover:underline">{r.stripeRefundId}</Link>
                    ) : (
                      <span className="font-mono text-xs">{r.stripeRefundId}</span>
                    )}
                    {r.reason ? <div className="text-[11px] text-muted-foreground">{r.reason}</div> : null}
                  </Td>
                  <Td className="text-xs">{r.organization?.name ?? <span className="text-muted-foreground">{t("admin.invoices.common.unmatched")}</span>}</Td>
                  <Td><StatusBadge domain="refund" value={r.status}>{t(`admin.payments.refunds.status.${r.status}`)}</StatusBadge></Td>
                  <Td className="tabular text-xs">{formatMoney({ amountMinor: r.amountMinor, currency: r.currency }, locale)}</Td>
                  <Td className="text-xs">{r.admin ? t("admin.payments.refunds.by", { name: r.admin }) : t("admin.payments.refunds.external")}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground"><Timestamp value={r.createdAt} mode="absolute" /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={`${base}/refunds`} params={params} cursor={page.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
