import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AccountingTabs } from "@/components/finance/finance-tabs";
import { JournalForm } from "@/components/finance/journal-form";
import { financePage } from "@/components/finance/page-context";
import { Empty, Pager, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import type { JournalSource } from "@/generated/prisma/enums";
import { pageParam, param } from "@/server/modules/finance/common";
import { listJournalEntries, listLedgerAccounts } from "@/server/modules/finance/ledger";
import { listCostCenters } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.accounting.tabs.journal") };
}

const SOURCES = ["MANUAL", "INVOICE", "PAYMENT", "CREDIT_NOTE", "TRANSACTION", "OPENING", "REVERSAL"] as const;

export default async function JournalPage({ searchParams }: PageProps<"/[locale]/finance/accounting/journal">) {
  const p = await financePage("accounting");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const params = await searchParams;
  const q = param(params, "q")?.slice(0, 200);
  const st = param(params, "status");
  const src = param(params, "source");
  const page = pageParam(params);
  const status = st === "DRAFT" || st === "POSTED" ? st : undefined;
  const source = (SOURCES as readonly string[]).includes(src ?? "") ? (src as JournalSource) : undefined;
  const [list, accounts, costCenters] = await Promise.all([
    listJournalEntries(viewer.ctx, org.id, company.id, { q, status, source, page }),
    p.canManage ? listLedgerAccounts(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    p.canManage ? listCostCenters(viewer.ctx, org.id, company.id) : Promise.resolve([]),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / 50));
  const path = `/${locale}/finance/accounting/journal`;
  return p.frame(
    <>
      <AccountingTabs locale={locale} active="journal" t={t} />
      {p.canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.journal.new")}</summary>
            <div className="border-t p-4">
              <JournalForm base={base} locale={locale} accounts={accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} costCenters={costCenters.map((c) => ({ value: c.id, label: c.name }))} />
            </div>
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("finance.accounting.tabs.journal")} description={t("finance.journal.hint")} />
        <form action={path} className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_auto]">
          <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} placeholder={t("finance.journal.search")} aria-label={t("finance.search")} />
          <Select name="status" defaultValue={status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("finance.allStatuses")}</option>
            <option value="DRAFT">{t("finance.journal.statuses.DRAFT")}</option>
            <option value="POSTED">{t("finance.journal.statuses.POSTED")}</option>
          </Select>
          <Select name="source" defaultValue={source ?? ""} aria-label={t("finance.journal.source")}>
            <option value="">{t("finance.allTypes")}</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`finance.journal.sources.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("finance.apply")}
          </Button>
        </form>
        {!list.rows.length ? (
          <Empty>{t("finance.journal.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>#</Th>
                <Th>{t("finance.fields.date")}</Th>
                <Th>{t("finance.journal.memo")}</Th>
                <Th>{t("finance.journal.source")}</Th>
                <Th>{t("finance.journal.accounts")}</Th>
                <Th className="text-end">{t("finance.fields.amount")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.rows.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <Link href={`${path}/${e.id}`} className="font-mono font-medium hover:underline">
                      {e.number}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{day(e.date)}</Td>
                  <Td>
                    {e.memo ?? "—"} {e.status === "DRAFT" ? <StatusBadge tone="warning">{t("finance.journal.statuses.DRAFT")}</StatusBadge> : null}
                  </Td>
                  <Td className="text-muted-foreground">{t(`finance.journal.sources.${e.source}`)}</Td>
                  <Td className="max-w-80 truncate text-xs text-muted-foreground">{[...new Set(e.lines.map((l) => `${l.ledgerAccount.code} ${l.ledgerAccount.name}`))].join(", ")}</Td>
                  <Td className="text-end tabular-nums">{money(e.totalMinor)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={params} page={page} pages={pages} labels={{ previous: t("common.previous"), next: t("common.next"), page: t("finance.pageOf", { page, pages }) }} />
      </Card>
    </>,
  );
}
