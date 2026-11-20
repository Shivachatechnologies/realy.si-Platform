import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AccountingTabs } from "@/components/finance/finance-tabs";
import { JournalForm } from "@/components/finance/journal-form";
import { financePage } from "@/components/finance/page-context";
import { ActionButton } from "@/components/finance/ui";
import { StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { dayString, fromMinor } from "@/server/modules/finance/common";
import { getJournalEntry, listLedgerAccounts } from "@/server/modules/finance/ledger";
import { listCostCenters } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.accounting.tabs.journal") };
}

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("accounting");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day, currency } = p;
  const e = await getJournalEntry(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const draft = e.status === "DRAFT";
  const [accounts, costCenters] = draft && p.canManage ? await Promise.all([listLedgerAccounts(viewer.ctx, org.id, company.id), listCostCenters(viewer.ctx, org.id, company.id)]) : [[], []];
  const debit = e.lines.reduce((s, l) => s + l.debitMinor, 0n);
  const credit = e.lines.reduce((s, l) => s + l.creditMinor, 0n);
  return p.frame(
    <>
      <AccountingTabs locale={locale} active="journal" t={t} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/finance/accounting/journal`} className="w-full text-xs text-muted-foreground hover:underline">
          ← {t("finance.accounting.tabs.journal")}
        </Link>
        <h2 className="text-base font-semibold">{t("finance.journal.entry", { number: e.number })}</h2>
        <StatusBadge tone={draft ? "warning" : "success"}>{t(`finance.journal.statuses.${e.status}`)}</StatusBadge>
        <StatusBadge tone="neutral">{t(`finance.journal.sources.${e.source}`)}</StatusBadge>
        <span className="text-sm text-muted-foreground">{day(e.date)}</span>
        {e.reversal ? (
          <Link href={`/${locale}/finance/accounting/journal/${e.reversal.id}`} className="text-xs hover:underline">
            {t("finance.journal.reversedBy", { number: e.reversal.number })}
          </Link>
        ) : null}
        {e.reversesId ? (
          <Link href={`/${locale}/finance/accounting/journal/${e.reversesId}`} className="text-xs hover:underline">
            {t("finance.journal.reverses")}
          </Link>
        ) : null}
        {p.canManage ? (
          <span className="ms-auto flex flex-wrap gap-2">
            {draft ? <ActionButton endpoint={`${base}/journal/${e.id}/post`} label={t("finance.journal.post")} variant="default" /> : null}
            {draft ? <ActionButton endpoint={`${base}/journal/${e.id}`} method="DELETE" label={t("finance.delete")} variant="danger" confirm={t("finance.journal.confirmDelete")} redirectTo={`/${locale}/finance/accounting/journal`} /> : null}
            {!draft && !e.reversal && (e.source === "MANUAL" || e.source === "OPENING") ? <ActionButton endpoint={`${base}/journal/${e.id}/reverse`} label={t("finance.journal.reverse")} confirm={t("finance.journal.confirmReverse")} redirectTo={`/${locale}/finance/accounting/journal/:id`} /> : null}
          </span>
        ) : null}
      </div>
      {e.memo ? <p className="text-sm">{e.memo}</p> : null}
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>{t("finance.journal.account")}</Th>
              <Th>{t("finance.fields.description")}</Th>
              <Th>{t("finance.fields.costCenter")}</Th>
              <Th className="text-end">{t("finance.journal.debit")}</Th>
              <Th className="text-end">{t("finance.journal.credit")}</Th>
            </Tr>
          </THead>
          <TBody>
            {e.lines.map((l) => (
              <Tr key={l.id}>
                <Td>
                  <Link href={`/${locale}/finance/accounting/ledger/${l.ledgerAccount.id}`} className="hover:underline">
                    <span className="font-mono">{l.ledgerAccount.code}</span> {l.ledgerAccount.name}
                  </Link>
                </Td>
                <Td className="text-muted-foreground">{l.description ?? ""}</Td>
                <Td className="text-muted-foreground">{l.department?.name ?? ""}</Td>
                <Td className="text-end tabular-nums">{l.debitMinor ? money(l.debitMinor) : ""}</Td>
                <Td className="text-end tabular-nums">{l.creditMinor ? money(l.creditMinor) : ""}</Td>
              </Tr>
            ))}
            <Tr>
              <Td colSpan={3} className="font-medium">
                {t("finance.billing.total")} {debit !== credit ? <StatusBadge tone="danger">{t("finance.journal.unbalanced", { diff: money(debit - credit) })}</StatusBadge> : null}
              </Td>
              <Td className="text-end font-medium tabular-nums">{money(debit)}</Td>
              <Td className="text-end font-medium tabular-nums">{money(credit)}</Td>
            </Tr>
          </TBody>
        </Table>
      </Card>
      {draft && p.canManage ? (
        <Card>
          <CardHeader title={t("finance.edit")} />
          <CardBody>
            <JournalForm
              base={base}
              locale={locale}
              id={e.id}
              accounts={accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
              costCenters={costCenters.map((c) => ({ value: c.id, label: c.name }))}
              initial={{
                date: dayString(e.date),
                memo: e.memo ?? "",
                lines: e.lines.map((l) => ({ ledgerAccountId: l.ledgerAccountId, debit: l.debitMinor ? fromMinor(l.debitMinor, currency) : "", credit: l.creditMinor ? fromMinor(l.creditMinor, currency) : "", description: l.description ?? "", departmentId: l.departmentId ?? "" })),
              }}
            />
          </CardBody>
        </Card>
      ) : null}
    </>,
  );
}
