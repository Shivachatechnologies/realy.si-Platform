import type { Metadata } from "next";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ClaimForm } from "@/components/finance/approval-forms";
import { txnOptions } from "@/components/finance/options";
import { financePage } from "@/components/finance/page-context";
import { CLAIM_TONE, Empty, Pager, StatusBadge, withParams } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { CLAIM_STATUSES, listExpenseClaims, parseClaimFilters } from "@/server/modules/finance/expense-claims";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.claims") };
}

export default async function ClaimsPage({ searchParams }: PageProps<"/[locale]/finance/claims">) {
  const p = await financePage("claims");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const params = await searchParams;
  const f = parseClaimFilters(params);
  const [list, options] = await Promise.all([listExpenseClaims(viewer.ctx, org.id, company.id, f), txnOptions(viewer.ctx, org.id, company.id)]);
  const path = `/${locale}/finance/claims`;
  const filtered = !!(f.q || f.status);
  return p.frame(
    <>
      <Card>
        <CardHeader title={t("finance.claims.submitTitle")} description={t("finance.claims.submitHint")} />
        <CardBody>
          <ClaimForm base={base} locale={locale} categories={options.categories.filter((c) => c.kind === "EXPENSE")} costCenters={options.costCenters} projects={options.projects ?? []} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={list.all ? t("finance.claims.allTitle") : t("finance.claims.mineTitle")} description={t("finance.count", { count: list.total })} />
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          {p.canManage ? (
            <nav className="flex gap-1 text-sm">
              {[false, true].map((all) => (
                <Link key={String(all)} href={withParams(path, {}, { all: all ? 1 : undefined })} aria-current={list.all === all ? "page" : undefined} className={cn("rounded-md px-3 py-1.5", list.all === all ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
                  {all ? t("finance.claims.everyone") : t("finance.claims.mine")}
                </Link>
              ))}
            </nav>
          ) : null}
          <form action={path} className="ms-auto flex flex-wrap gap-2">
            {list.all ? <input type="hidden" name="all" value="1" /> : null}
            <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} placeholder={t("finance.search")} aria-label={t("finance.search")} className="h-8 w-48" />
            <Select name="status" defaultValue={f.status ?? ""} aria-label={t("common.status")} className="h-8 w-36">
              <option value="">{t("finance.allStatuses")}</option>
              {CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`finance.claims.statuses.${s}`)}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" variant="secondary">
              {t("finance.apply")}
            </Button>
          </form>
        </div>
        {!list.rows.length ? (
          <Empty>{filtered ? t("common.noResults") : t("finance.claims.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.date")}</Th>
                <Th>{t("finance.fields.description")}</Th>
                {list.all ? <Th>{t("finance.claims.requester")}</Th> : null}
                <Th>{t("finance.budgets.scope")}</Th>
                <Th>{t("common.status")}</Th>
                <Th className="text-end">{t("finance.fields.amount")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.rows.map((c) => (
                <Tr key={c.id}>
                  <Td className="whitespace-nowrap">{day(c.date)}</Td>
                  <Td>
                    <Link href={`${path}/${c.id}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                      {c.description}
                      {c.receipt ? <Paperclip className="size-3 text-muted-foreground" aria-label={t("finance.claims.receipt")} /> : null}
                    </Link>
                    {c.merchant ? <span className="block text-xs text-muted-foreground">{c.merchant}</span> : null}
                  </Td>
                  {list.all ? <Td>{c.requesterName ?? "—"}</Td> : null}
                  <Td className="text-xs text-muted-foreground">{[c.category?.name, c.department?.name, c.project?.name].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td>
                    <StatusBadge tone={CLAIM_TONE[c.status]}>{t(`finance.claims.statuses.${c.status}`)}</StatusBadge>
                  </Td>
                  <Td className="text-end font-medium tabular-nums">{money(c.amountMinor, c.currency)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={params} page={f.page} pages={list.pages} labels={{ previous: t("common.previous"), next: t("common.next"), page: t("finance.pageOf", { page: f.page, pages: list.pages }) }} />
      </Card>
    </>,
  );
}
