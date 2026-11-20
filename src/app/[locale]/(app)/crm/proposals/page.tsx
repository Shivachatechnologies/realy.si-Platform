import type { Metadata } from "next";
import Link from "next/link";
import { NewProposalForm } from "@/components/crm/proposals";
import { CrmFrame, PROPOSAL_TONE, Pager, Stat, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { contactName } from "@/server/modules/crm/contacts";
import { listDeals } from "@/server/modules/crm/deals";
import { listProposals, parseProposalFilters, PROPOSAL_SORTS, PROPOSAL_STATUSES } from "@/server/modules/crm/proposals";
import { listOwners } from "@/server/modules/crm/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.proposals") };
}

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const query = await searchParams;
  if (!c.company || !c.canRead) return <CrmFrame active="proposals">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer } = c;
  const filters = parseProposalFilters(query);
  const [list, owners, deals, accepted, open] = await Promise.all([
    listProposals(viewer.ctx, org.id, company.id, filters),
    listOwners(viewer.ctx, org.id, company.id),
    c.canManage ? listDeals(viewer.ctx, org.id, company.id, { status: "OPEN", sort: "updated" }, { take: 200 }) : Promise.resolve({ rows: [] }),
    listProposals(viewer.ctx, org.id, company.id, { status: "ACCEPTED" }, { take: 1 }),
    listProposals(viewer.ctx, org.id, company.id, { status: "VIEWED" }, { take: 1 }),
  ]);
  const money = (m: bigint, cur: string) => formatMoney({ amountMinor: m, currency: cur }, locale);
  const filtered = !!(filters.q || filters.status || filters.owner || filters.dealId);
  return (
    <CrmFrame active="proposals" subtitle={t("crm.proposals.subtitle")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("crm.proposals.matching")} value={list.total} />
        <Stat label={t("crm.proposals.viewedOpen")} value={open.total} />
        <Stat label={t("crm.proposals.acceptedCount")} value={accepted.total} />
      </div>
      {c.canManage ? (
        <Card>
          <CardHeader title={t("crm.proposals.new")} description={t("crm.proposals.newHint")} />
          <CardBody>
            <NewProposalForm base={base} locale={locale} deals={deals.rows.map((d) => ({ id: d.id, name: d.account ? `${d.name} · ${d.account.name}` : d.name }))} />
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("crm.tabs.proposals")} description={t("crm.proposals.count", { count: list.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_auto]" action={`/${locale}/crm/proposals`}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("crm.search")} placeholder={t("crm.proposals.searchPlaceholder")} />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("crm.deals.anyStatus")}</option>
            {PROPOSAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`crm.proposals.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="owner" defaultValue={filters.owner ?? ""} aria-label={t("crm.owner")}>
            <option value="">{t("crm.allOwners")}</option>
            <option value="me">{t("crm.mine")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={filters.sort ?? ""} aria-label={t("crm.sort")}>
            {PROPOSAL_SORTS.map((s) => (
              <option key={s} value={s === "created" ? "" : s}>
                {t(`crm.proposals.sorts.${s}`)}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            {filters.dealId ? <input type="hidden" name="deal" value={filters.dealId} /> : null}
            <Button type="submit" variant="secondary">
              {t("crm.applyFilters")}
            </Button>
            {filtered ? (
              <Button asChild variant="ghost">
                <Link href={`/${locale}/crm/proposals`}>{t("crm.clearFilters")}</Link>
              </Button>
            ) : null}
          </div>
        </form>
        {list.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start font-medium">{t("crm.proposals.titleLabel")}</th>
                  <th className="p-2 text-start font-medium">{t("crm.proposals.deal")}</th>
                  <th className="p-2 text-start font-medium">{t("common.status")}</th>
                  <th className="p-2 text-end font-medium">{t("crm.proposals.total")}</th>
                  <th className="p-2 text-start font-medium">{t("crm.proposals.validUntil")}</th>
                  <th className="p-2 text-start font-medium">{t("crm.owner")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.rows.map((p) => (
                  <tr key={p.id}>
                    <td className="p-2">
                      <Link href={`/${locale}/crm/proposals/${p.id}`} className="font-medium hover:underline">
                        {p.number} · {p.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[p.account?.name, p.contact ? contactName(p.contact) : null, `v${p.version}`].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="p-2">
                      <Link href={`/${locale}/crm/deals/${p.deal.id}`} className="hover:underline">
                        {p.deal.name}
                      </Link>
                    </td>
                    <td className="p-2">
                      <Badge tone={PROPOSAL_TONE[p.status]}>{t(`crm.proposals.status.${p.status}`)}</Badge>
                    </td>
                    <td className="p-2 text-end tabular-nums">{money(p.totalMinor, p.currency)}</td>
                    <td className="p-2 text-xs text-muted-foreground">{p.validUntil ? formatDate(p.validUntil, locale, "UTC") : "—"}</td>
                    <td className="p-2 text-xs">{p.ownerName ?? t("crm.unassigned")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{filtered ? t("crm.proposals.noMatch") : t("crm.proposals.empty")}</p>
        )}
        <Pager path={`/${locale}/crm/proposals`} query={query} page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </CrmFrame>
  );
}
