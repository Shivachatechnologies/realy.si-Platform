import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { Empty, ESTIMATE_TONE, Pager, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import type { EstimateStatus } from "@/generated/prisma/enums";
import { ESTIMATE_STATUSES, listEstimates } from "@/server/modules/finance/billing";
import { pageParam, param } from "@/server/modules/finance/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.estimates") };
}

export default async function EstimatesPage({ searchParams }: PageProps<"/[locale]/finance/estimates">) {
  const p = await financePage("estimates");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, day } = p;
  const params = await searchParams;
  const q = param(params, "q")?.slice(0, 200);
  const s = param(params, "status");
  const status = (ESTIMATE_STATUSES as readonly string[]).includes(s ?? "") ? (s as EstimateStatus) : undefined;
  const page = pageParam(params);
  const list = await listEstimates(viewer.ctx, org.id, company.id, { q, status, page });
  const path = `/${locale}/finance/estimates`;
  return p.frame(
    <Card>
      <CardHeader
        title={t("finance.tabs.estimates")}
        description={t("finance.estimates.hint")}
        actions={
          p.canManage ? (
            <Button asChild size="sm">
              <Link href={`${path}/new`}>
                <Plus aria-hidden />
                {t("finance.estimates.new")}
              </Link>
            </Button>
          ) : null
        }
      />
      <form action={path} className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} placeholder={t("finance.invoices.search")} aria-label={t("finance.search")} />
        <Select name="status" defaultValue={status ?? ""} aria-label={t("common.status")}>
          <option value="">{t("finance.allStatuses")}</option>
          {ESTIMATE_STATUSES.map((x) => (
            <option key={x} value={x}>
              {t(`finance.estimates.statuses.${x}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          {t("finance.apply")}
        </Button>
      </form>
      {!list.rows.length ? (
        <Empty>{q || status ? t("common.noResults") : t("finance.estimates.empty")}</Empty>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("finance.billing.number")}</Th>
              <Th>{t("finance.fields.customer")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("finance.billing.issueDate")}</Th>
              <Th>{t("finance.billing.expiryDate")}</Th>
              <Th className="text-end">{t("finance.billing.total")}</Th>
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
                <Td>{e.account.name}</Td>
                <Td>
                  <StatusBadge tone={ESTIMATE_TONE[e.status]}>{t(`finance.estimates.statuses.${e.status}`)}</StatusBadge>
                </Td>
                <Td className="whitespace-nowrap">{day(e.issueDate)}</Td>
                <Td className="whitespace-nowrap">{e.expiryDate ? day(e.expiryDate) : "—"}</Td>
                <Td className="text-end tabular-nums">{money(e.totalMinor, e.currency)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <Pager path={path} params={params} page={page} pages={list.pages} labels={{ previous: t("common.previous"), next: t("common.next"), page: t("finance.pageOf", { page, pages: list.pages }) }} />
    </Card>,
  );
}
