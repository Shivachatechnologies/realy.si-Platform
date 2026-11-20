import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { BILL_TONE, Empty, Kpi, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { AGING_BUCKETS } from "@/server/modules/finance/billing";
import { payablesAging, upcomingPayables } from "@/server/modules/finance/payables";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.payables") };
}

export default async function PayablesPage() {
  const p = await financePage("payables");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, day } = p;
  const [aging, upcoming] = await Promise.all([payablesAging(viewer.ctx, org.id, company.id), upcomingPayables(db(), company.id, 30)]);
  const overdue = aging.bills.filter((b) => b.bucket !== "current");
  const soon = upcoming.filter((b) => !b.overdue);
  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("finance.payables.total")} value={money(aging.total)} />
        {AGING_BUCKETS.map((b) => (
          <Kpi key={b} label={t(`finance.receivables.buckets.${b}`)} value={money(aging.totals[b])} tone={b === "d90_plus" && aging.totals[b] > 0n ? "danger" : b !== "current" && aging.totals[b] > 0n ? "warning" : undefined} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("finance.payables.upcomingTitle")} description={t("finance.payables.upcomingHint", { amount: money(soon.reduce((s, b) => s + b.balanceMinor, 0n)) })} />
          {!soon.length ? (
            <Empty>{t("finance.payables.noUpcoming")}</Empty>
          ) : (
            <ul className="grid divide-y text-sm">
              {soon.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <Link href={`/${locale}/finance/bills/${b.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {b.vendor.name} · <span className="font-mono">{b.number}</span>
                  </Link>
                  <span className="text-xs text-muted-foreground">{day(b.dueDate)}</span>
                  <span className="w-28 text-end tabular-nums">{money(b.balanceMinor, b.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("finance.payables.byVendor")} />
          {!aging.vendors.length ? (
            <Empty>{t("finance.payables.empty")}</Empty>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("finance.fields.vendor")}</Th>
                  <Th className="text-end">{t("finance.payables.overdue")}</Th>
                  <Th className="text-end">{t("finance.billing.total")}</Th>
                </Tr>
              </THead>
              <TBody>
                {aging.vendors.map((v) => {
                  const late = v.total - v.buckets.current;
                  return (
                    <Tr key={v.id}>
                      <Td>
                        <Link href={`/${locale}/finance/bills?vendor=${v.id}`} className="font-medium hover:underline">
                          {v.name}
                        </Link>
                      </Td>
                      <Td className={cn("text-end tabular-nums", late > 0n && "text-danger")}>{late ? money(late) : "—"}</Td>
                      <Td className="text-end font-medium tabular-nums">{money(v.total)}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("finance.payables.agingTitle")} description={t("finance.payables.agingHint")} />
        {!aging.vendors.length ? (
          <Empty>{t("finance.payables.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.vendor")}</Th>
                {AGING_BUCKETS.map((b) => (
                  <Th key={b} className="text-end">
                    {t(`finance.receivables.buckets.${b}`)}
                  </Th>
                ))}
                <Th className="text-end">{t("finance.billing.total")}</Th>
              </Tr>
            </THead>
            <TBody>
              {aging.vendors.map((v) => (
                <Tr key={v.id}>
                  <Td className="font-medium">{v.name}</Td>
                  {AGING_BUCKETS.map((b) => (
                    <Td key={b} className="text-end tabular-nums">
                      {v.buckets[b] ? money(v.buckets[b]) : "—"}
                    </Td>
                  ))}
                  <Td className="text-end font-medium tabular-nums">{money(v.total)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("finance.payables.overdueTitle")} description={t("finance.payables.overdueHint")} />
        {!overdue.length ? (
          <Empty>{t("finance.payables.noOverdue")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.bills.number")}</Th>
                <Th>{t("finance.fields.vendor")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("finance.billing.dueDate")}</Th>
                <Th className="text-end">{t("finance.receivables.daysOverdue")}</Th>
                <Th className="text-end">{t("finance.invoices.balanceDue")}</Th>
              </Tr>
            </THead>
            <TBody>
              {overdue.map((b) => (
                <Tr key={b.id}>
                  <Td>
                    <Link href={`/${locale}/finance/bills/${b.id}`} className="font-mono font-medium hover:underline">
                      {b.number}
                    </Link>
                  </Td>
                  <Td>{b.vendor.name}</Td>
                  <Td>
                    <StatusBadge tone={BILL_TONE[b.status]}>{t(`finance.bills.statuses.${b.status}`)}</StatusBadge>
                  </Td>
                  <Td className="whitespace-nowrap">{day(b.dueDate)}</Td>
                  <Td className="text-end tabular-nums">{b.daysOverdue}</Td>
                  <Td className="text-end font-medium tabular-nums">{money(b.balanceMinor, b.currency)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
