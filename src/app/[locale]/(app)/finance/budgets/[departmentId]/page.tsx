import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { Empty, Kpi, UsageBar } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { departmentSpendDetail, parseBudgetWindow } from "@/server/modules/finance/budgets";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.budgets") };
}

export default async function DepartmentBudgetPage({ params, searchParams }: { params: Promise<{ departmentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { departmentId } = await params;
  const p = await financePage("budgets");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, day } = p;
  const w = parseBudgetWindow(await searchParams);
  const d = await departmentSpendDetail(viewer.ctx, org.id, company.id, departmentId, w).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const pct = d.budgetMinor > 0n ? Number((d.totalMinor * 10_000n) / d.budgetMinor) / 100 : null;
  const head = d.department.head ? [d.department.head.firstName, d.department.head.lastName].filter(Boolean).join(" ") : null;
  return p.frame(
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/finance/budgets?period=${w.period}&at=${w.at}`} className="w-full text-xs text-muted-foreground hover:underline">
          ← {t("finance.tabs.budgets")}
        </Link>
        <h2 className="text-base font-semibold">{d.department.name}</h2>
        <span className="text-sm text-muted-foreground">{w.label}</span>
        {head ? <span className="text-sm text-muted-foreground">· {t("finance.budgets.ownerIs", { name: head })}</span> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label={t("finance.budgets.budget")} value={d.budgetMinor ? money(d.budgetMinor) : "—"} />
        <Kpi label={t("finance.budgets.actual")} value={money(d.totalMinor)} tone={pct !== null && pct > 100 ? "danger" : undefined} />
        <Kpi label={t("finance.budgets.remaining")} value={d.budgetMinor ? money(d.budgetMinor - d.totalMinor) : "—"} />
        <Kpi label={t("finance.budgets.used")} value={<UsageBar pct={pct} />} />
      </div>
      <Card>
        <CardHeader title={t("finance.tabs.transactions")} description={money(d.transactionsMinor)} actions={<Link href={`/${locale}/finance/transactions?costCenter=${d.department.id}&type=EXPENSE`} className="text-xs hover:underline">{t("finance.budgets.openAll")}</Link>} />
        {!d.transactions.length ? (
          <Empty>{t("finance.budgets.noSpend")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.date")}</Th>
                <Th>{t("finance.fields.description")}</Th>
                <Th>{t("finance.fields.category")}</Th>
                <Th>{t("finance.fields.vendor")}</Th>
                <Th className="text-end">{t("finance.fields.amount")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.transactions.map((x) => (
                <Tr key={x.id}>
                  <Td className="whitespace-nowrap">{day(x.date)}</Td>
                  <Td>
                    <Link href={`/${locale}/finance/transactions/${x.id}`} className="font-medium hover:underline">
                      {x.description}
                    </Link>
                  </Td>
                  <Td className="text-muted-foreground">{x.category?.name ?? t("finance.fields.uncategorized")}</Td>
                  <Td className="text-muted-foreground">{x.account?.name ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{money(x.amountMinor, x.currency)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("finance.tabs.bills")} description={money(d.billsMinor)} />
        {!d.billLines.length ? (
          <Empty>{t("finance.budgets.noBills")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.bills.billDate")}</Th>
                <Th>{t("finance.bills.number")}</Th>
                <Th>{t("finance.fields.description")}</Th>
                <Th>{t("finance.fields.category")}</Th>
                <Th className="text-end">{t("finance.bills.netAmount")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.billLines.map((l) => (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap">{day(l.bill.issueDate)}</Td>
                  <Td>
                    <Link href={`/${locale}/finance/bills/${l.bill.id}`} className="font-mono font-medium hover:underline">
                      {l.bill.number}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{l.bill.vendor.name}</span>
                  </Td>
                  <Td>{l.description}</Td>
                  <Td className="text-muted-foreground">{l.category?.name ?? t("finance.fields.uncategorized")}</Td>
                  <Td className="text-end tabular-nums">{money(l.netMinor)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("finance.budgets.title")} />
        {!d.budgets.length ? (
          <Empty>{t("finance.budgets.noDepartmentBudget")}</Empty>
        ) : (
          <ul className="grid divide-y text-sm">
            {d.budgets.map((b) => (
              <li key={b.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span className="font-medium">{b.name}</span>
                <span className="text-muted-foreground">
                  {day(b.periodStart)} – {day(b.periodEnd)}
                  {b.category ? ` · ${b.category.name}` : ""}
                </span>
                <span className="tabular-nums">{money(b.amountMinor, b.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>,
  );
}
