import Link from "next/link";
import { Download, FileText, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, guard, sp } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { BackfillPanel } from "@/components/admin/billing/actions";
import { DataSource } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { billingConfigured } from "@/server/modules/billing/stripe-billing";
import { INVOICE_STATUSES, listPlatformInvoices, mirrorStatus } from "@/server/modules/billing/explorers";
import { requireViewer } from "@/server/session";

/** Invoice explorer over the Stripe mirror: status chips, filters, keyset pagination, CSV, admin backfill. */
export default async function InvoicesPage({ searchParams }: PageProps<"/[locale]/invoices">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { q: sp(q.q), status: sp(q.status), org: sp(q.org), currency: sp(q.currency), from: sp(q.from), to: sp(q.to), overdue: sp(q.overdue), limit: sp(q.limit) };
  const res = await guard(listPlatformInvoices(viewer.ctx, { ...params, cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { page, byStatus } = res.value;
  const [mirror, canSync] = await Promise.all([mirrorStatus(), canPlatform(viewer.ctx, "platform.subscriptions.manage")]);
  const base = `/${locale}/invoices`;
  const exportQs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const anyFilter = Object.entries(params).some(([k, v]) => k !== "limit" && !!v);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<FileText />}
        title={t("admin.invoices.title")}
        description={t("admin.invoices.subtitle")}
        why={t("admin.invoices.why")}
        actions={
          <Button asChild size="sm" variant="secondary">
            <a href={`/api/v1/admin/invoices/export?${exportQs}`}>
              <Download className="size-3.5" aria-hidden /> {t("admin.invoices.common.export")}
            </a>
          </Button>
        }
        meta={<DataSource source={t("admin.invoices.source")} updatedAt={mirror.lastSyncedAt} updatedLabel={t("admin.invoices.common.lastSynced")} />}
      />
      <Card>
        <QuickFilters
          base={base}
          name="status"
          value={params.status}
          params={params}
          label={t("admin.invoices.common.status")}
          options={[{ value: "", label: t("admin.invoices.common.all") }, ...INVOICE_STATUSES.map((s) => ({ value: s, label: t(`admin.invoices.status.${s}`), count: byStatus[s] ?? 0 }))]}
        />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.invoices.search")}
          values={params}
          submitLabel={t("admin.invoices.common.apply")}
          filters={[
            { name: "status", label: t("admin.invoices.common.status"), options: INVOICE_STATUSES.map((s) => ({ value: s, label: t(`admin.invoices.status.${s}`) })) },
            { name: "limit", label: t("admin.invoices.common.pageSize"), options: ["25", "50", "100", "200"].map((n) => ({ value: n, label: n })) },
          ]}
          extra={
            <>
              <Input name="currency" defaultValue={params.currency} placeholder="EUR" maxLength={3} aria-label={t("admin.invoices.common.currency")} className="w-20 font-mono" />
              <Input name="from" type="date" defaultValue={params.from} aria-label={t("admin.invoices.common.from")} className="w-auto" />
              <Input name="to" type="date" defaultValue={params.to} aria-label={t("admin.invoices.common.to")} className="w-auto" />
              {params.org ? <input type="hidden" name="org" value={params.org} /> : null}
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" name="overdue" value="1" defaultChecked={params.overdue === "1"} /> {t("admin.invoices.overdue")}
              </label>
              {anyFilter ? (
                <Link href={base} className="text-xs text-primary hover:underline">
                  {t("admin.invoices.common.reset")}
                </Link>
              ) : null}
            </>
          }
        />
        {page.data.length === 0 ? (
          <EmptyState icon={<SearchX />} title={anyFilter ? t("common.noResults") : t("admin.invoices.empty")} body={anyFilter ? undefined : t("admin.invoices.emptyHint")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.invoices.number")}</Th>
                <Th>{t("admin.invoices.common.organization")}</Th>
                <Th>{t("admin.invoices.common.status")}</Th>
                <Th>{t("admin.invoices.total")}</Th>
                <Th>{t("admin.invoices.remaining")}</Th>
                <Th>{t("admin.invoices.common.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {page.data.map((i) => {
                const overdue = i.status === "open" && i.dueAt && i.dueAt < new Date();
                return (
                  <Tr key={i.id}>
                    <Td>
                      <Link href={`${base}/${i.id}`} className="font-medium hover:underline">
                        {i.number ?? i.stripeInvoiceId}
                      </Link>
                      {!i.livemode ? <Badge tone="warning" className="ms-1.5">{t("admin.invoices.common.test")}</Badge> : null}
                      <div className="font-mono text-[11px] text-muted-foreground">{i.billingReason ?? "—"}</div>
                    </Td>
                    <Td className="text-xs">
                      {i.organization ? (
                        <Link href={`${base}?org=${i.organizationId}`} className="hover:underline">
                          {i.organization.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{t("admin.invoices.common.unmatched")}</span>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge domain="invoice" value={i.status}>
                        {t(`admin.invoices.status.${i.status}`)}
                      </StatusBadge>
                      {overdue ? <div className="text-[11px] text-danger">{t("admin.invoices.overdue")}</div> : null}
                    </Td>
                    <Td className="tabular text-xs">{formatMoney({ amountMinor: i.totalMinor, currency: i.currency }, locale)}</Td>
                    <Td className="tabular text-xs">{i.amountRemainingMinor > 0n ? formatMoney({ amountMinor: i.amountRemainingMinor, currency: i.currency }, locale) : "—"}</Td>
                    <Td className="text-xs whitespace-nowrap text-muted-foreground">
                      <Timestamp value={i.createdAt} mode="absolute" />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={page.nextCursor} label={t("common.next")} />
      </Card>
      {canSync ? (
        <Card>
          <CardHeader title={t("admin.invoices.sync.title")} description={t("admin.invoices.sync.description")} />
          <CardBody>
            <BackfillPanel configured={billingConfigured()} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
