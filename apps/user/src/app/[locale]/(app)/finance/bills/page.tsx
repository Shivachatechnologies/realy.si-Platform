import type { Metadata } from "next";
import Link from "next/link";
import { Paperclip, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { projectOptions } from "@/components/finance/options";
import { BILL_TONE, Empty, Kpi, Pager, SortLink, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { todayUtc } from "@/server/modules/finance/common";
import { BILL_STATUSES, listBills, parseBillFilters } from "@/server/modules/finance/payables";
import { listCostCenters, listCounterparties } from "@/server/modules/finance/setup";
import { openPayables } from "@/server/modules/finance/spend";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.bills") };
}

export default async function BillsPage({ searchParams }: PageProps<"/[locale]/finance/bills">) {
  const p = await financePage("bills");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, day } = p;
  const params = await searchParams;
  const f = parseBillFilters(params);
  const today = todayUtc();
  const [list, vendors, costCenters, projects, open, overdue, awaiting] = await Promise.all([
    listBills(viewer.ctx, org.id, company.id, f),
    listCounterparties(viewer.ctx, org.id, company.id, "VENDOR"),
    listCostCenters(viewer.ctx, org.id, company.id),
    projectOptions(org.id, company.id),
    openPayables(db(), company.id),
    openPayables(db(), company.id, { dueBefore: today }),
    db().financeBill.count({ where: { companyId: company.id, status: "AWAITING_APPROVAL" } }),
  ]);
  const path = `/${locale}/finance/bills`;
  const filtered = !!(f.q || f.status || f.vendorId || f.departmentId || f.projectId || f.from || f.to || f.overdue);

  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label={t("finance.metrics.payablesOpen")} value={money(open)} />
        <Kpi label={t("finance.metrics.payablesOverdue")} value={money(overdue)} tone={overdue > 0n ? "danger" : undefined} hint={<Link href={`${path}?overdue=1`} className="hover:underline">{t("finance.bills.showOverdue")}</Link>} />
        <Kpi label={t("finance.bills.awaitingApproval")} value={awaiting} tone={awaiting ? "warning" : undefined} hint={<Link href={`/${locale}/finance/approvals`} className="hover:underline">{t("finance.tabs.approvals")}</Link>} />
      </div>
      <Card>
        <CardHeader
          title={t("finance.tabs.bills")}
          description={t("finance.count", { count: list.total })}
          actions={
            p.canManage ? (
              <Button asChild size="sm">
                <Link href={`${path}/new`}>
                  <Plus aria-hidden />
                  {t("finance.bills.new")}
                </Link>
              </Button>
            ) : null
          }
        />
        <form action={path} className="grid gap-2 border-b p-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_10rem_11rem_11rem_11rem_9rem_9rem_auto]">
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} placeholder={t("finance.bills.search")} aria-label={t("finance.search")} />
          <Select name="status" defaultValue={f.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("finance.allStatuses")}</option>
            {BILL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`finance.bills.statuses.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="vendor" defaultValue={f.vendorId ?? ""} aria-label={t("finance.fields.vendor")}>
            <option value="">{t("finance.bills.allVendors")}</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <Select name="costCenter" defaultValue={f.departmentId ?? ""} aria-label={t("finance.fields.costCenter")}>
            <option value="">{t("finance.allCostCenters")}</option>
            {costCenters.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select name="project" defaultValue={f.projectId ?? ""} aria-label={t("finance.fields.project")}>
            <option value="">{t("finance.projects.all")}</option>
            {projects.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input name="from" type="date" defaultValue={f.from ?? ""} aria-label={t("finance.range.from")} />
          <Input name="to" type="date" defaultValue={f.to ?? ""} aria-label={t("finance.range.to")} />
          <div className="flex items-center gap-2">
            {f.overdue ? <input type="hidden" name="overdue" value="1" /> : null}
            <Button type="submit" variant="secondary">
              {t("finance.apply")}
            </Button>
            {filtered ? (
              <Link href={path} className="text-xs text-muted-foreground hover:underline">
                {t("finance.clear")}
              </Link>
            ) : null}
          </div>
        </form>
        {!list.rows.length ? (
          <Empty>{filtered ? t("common.noResults") : t("finance.bills.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>
                  <SortLink path={path} params={params} field="number" current={f.sort} dir={f.dir}>
                    {t("finance.bills.number")}
                  </SortLink>
                </Th>
                <Th>{t("finance.fields.vendor")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>
                  <SortLink path={path} params={params} field="issueDate" current={f.sort} dir={f.dir}>
                    {t("finance.bills.billDate")}
                  </SortLink>
                </Th>
                <Th>
                  <SortLink path={path} params={params} field="dueDate" current={f.sort} dir={f.dir}>
                    {t("finance.billing.dueDate")}
                  </SortLink>
                </Th>
                <Th className="text-end">
                  <SortLink path={path} params={params} field="total" current={f.sort} dir={f.dir}>
                    {t("finance.billing.total")}
                  </SortLink>
                </Th>
                <Th className="text-end">{t("finance.invoices.balanceDue")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.rows.map((b) => {
                const late = (b.status === "APPROVED" || b.status === "PARTIALLY_PAID") && b.dueDate < today;
                return (
                  <Tr key={b.id}>
                    <Td>
                      <Link href={`${path}/${b.id}`} className="inline-flex items-center gap-1 font-mono font-medium hover:underline">
                        {b.number}
                        {b.attachment ? <Paperclip className="size-3 text-muted-foreground" aria-label={t("finance.bills.attachment")} /> : null}
                      </Link>
                    </Td>
                    <Td>{b.vendor.name}</Td>
                    <Td>
                      <StatusBadge tone={late ? "danger" : BILL_TONE[b.status]}>{late ? t("finance.bills.overdue") : t(`finance.bills.statuses.${b.status}`)}</StatusBadge>
                    </Td>
                    <Td className="whitespace-nowrap">{day(b.issueDate)}</Td>
                    <Td className={cn("whitespace-nowrap", late && "text-danger")}>{day(b.dueDate)}</Td>
                    <Td className="text-end tabular-nums">{money(b.totalMinor, b.currency)}</Td>
                    <Td className="text-end font-medium tabular-nums">{b.status === "VOID" || b.status === "DRAFT" || b.status === "AWAITING_APPROVAL" ? "—" : money(b.balanceMinor, b.currency)}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={params} page={f.page} pages={list.pages} labels={{ previous: t("common.previous"), next: t("common.next"), page: t("finance.pageOf", { page: f.page, pages: list.pages }) }} />
      </Card>
    </>,
  );
}
