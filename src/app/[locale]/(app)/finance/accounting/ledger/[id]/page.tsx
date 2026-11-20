import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AccountingTabs } from "@/components/finance/finance-tabs";
import { financePage } from "@/components/finance/page-context";
import { Empty, RangeForm, rangePresets } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { parseRange } from "@/server/modules/finance/common";
import { generalLedger } from "@/server/modules/finance/ledger";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledger.title") };
}

export default async function LedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const p = await financePage("accounting");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, day } = p;
  const range = parseRange(await searchParams);
  const gl = await generalLedger(viewer.ctx, org.id, company.id, id, range).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  return p.frame(
    <>
      <AccountingTabs locale={locale} active="chart" t={t} />
      <div className="grid gap-1">
        <Link href={`/${locale}/finance/accounting`} className="text-xs text-muted-foreground hover:underline">
          ← {t("finance.accounting.tabs.chart")}
        </Link>
        <h2 className="text-base font-semibold">
          {t("finance.ledger.title")}: <span className="font-mono">{gl.account.code}</span> {gl.account.name}
        </h2>
        <p className="text-xs text-muted-foreground">{t(`finance.chart.types.${gl.account.type}`)}</p>
      </div>
      <RangeForm action={`/${locale}/finance/accounting/ledger/${id}`} from={range.fromStr} to={range.toStr} labels={{ from: t("finance.range.from"), to: t("finance.range.to"), apply: t("finance.range.apply"), presets: rangePresets(t) }} />
      <Card>
        <CardHeader title={t("finance.ledger.opening", { amount: money(gl.opening) })} description={t("finance.ledger.closing", { amount: money(gl.closing) })} />
        {!gl.rows.length ? (
          <Empty>{t("finance.ledger.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.date")}</Th>
                <Th>#</Th>
                <Th>{t("finance.journal.memo")}</Th>
                <Th className="text-end">{t("finance.journal.debit")}</Th>
                <Th className="text-end">{t("finance.journal.credit")}</Th>
                <Th className="text-end">{t("finance.ledger.balance")}</Th>
              </Tr>
            </THead>
            <TBody>
              {gl.rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">{day(r.entry.date)}</Td>
                  <Td>
                    <Link href={`/${locale}/finance/accounting/journal/${r.entry.id}`} className="font-mono hover:underline">
                      {r.entry.number}
                    </Link>
                  </Td>
                  <Td>
                    {r.entry.memo ?? ""}
                    {r.description ? <span className="block text-xs text-muted-foreground">{r.description}</span> : null}
                  </Td>
                  <Td className="text-end tabular-nums">{r.debitMinor ? money(r.debitMinor) : ""}</Td>
                  <Td className="text-end tabular-nums">{r.creditMinor ? money(r.creditMinor) : ""}</Td>
                  <Td className="text-end font-medium tabular-nums">{money(r.balanceMinor)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
