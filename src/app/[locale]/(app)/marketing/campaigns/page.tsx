import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { CampaignForm } from "@/components/marketing/campaign-forms";
import { MarketingShell, Meter, Pager, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { CAMPAIGN_STATUSES, listCampaigns, parseCampaignFilters } from "@/server/modules/marketing/campaigns";
import { listSegments } from "@/server/modules/marketing/segments";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.campaigns") };
}

export default async function CampaignsPage({ searchParams }: PageProps<"/[locale]/marketing/campaigns">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "campaigns" as const, title: t("marketing.campaigns.title"), subtitle: t("marketing.campaigns.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage } = m;
  const f = parseCampaignFilters(await searchParams);
  const [list, segments] = await Promise.all([listCampaigns(viewer.ctx, org.id, company.id, f), canManage ? listSegments(viewer.ctx, org.id, company.id) : Promise.resolve([])]);
  const filtered = !!(f.q || f.status);
  const money = (v: bigint, c: string) => formatMoney({ amountMinor: v, currency: c }, locale);
  const path = `/${locale}/marketing/campaigns`;

  return (
    <MarketingShell {...shell}>
      {canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.campaigns.create")}</summary>
            <CampaignForm base={base} locale={locale} segments={segments.map((s) => ({ id: s.id, name: s.name }))} />
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("marketing.campaigns.title")} description={t("marketing.common.count", { count: list.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} aria-label={t("marketing.common.search")} placeholder={t("marketing.campaigns.searchPlaceholder")} />
          <Select name="status" defaultValue={f.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("marketing.common.allStatuses")}</option>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.campaignStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={f.sort ?? "newest"} aria-label={t("marketing.common.sort")}>
            <option value="newest">{t("marketing.common.sortNewest")}</option>
            <option value="name">{t("marketing.common.sortName")}</option>
            <option value="start">{t("marketing.campaigns.sortStart")}</option>
            <option value="budget">{t("marketing.campaigns.sortBudget")}</option>
          </Select>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary">
              {t("marketing.common.apply")}
            </Button>
            {filtered ? (
              <Link href={path} className="text-xs text-muted-foreground hover:underline">
                {t("marketing.common.clear")}
              </Link>
            ) : null}
          </div>
        </form>
        {list.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("marketing.campaigns.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.campaigns.campaign")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("marketing.campaigns.schedule")}</Th>
                <Th className="text-end">{t("marketing.campaigns.budget")}</Th>
                <Th className="min-w-40">{t("marketing.campaigns.spent")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((c) => {
                const used = c.budgetMinor > 0n ? (Number(c.spentMinor) / Number(c.budgetMinor)) * 100 : null;
                return (
                  <Tr key={c.id}>
                    <Td>
                      <Link href={`${path}/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="font-mono text-[11px] text-muted-foreground">{c.code}</div>
                    </Td>
                    <Td>
                      <StatusBadge status={c.status} label={t(`marketing.campaignStatus.${c.status}`)} />
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {c.startDate ? formatDate(c.startDate, locale, "UTC") : "—"} → {c.endDate ? formatDate(c.endDate, locale, "UTC") : "—"}
                    </Td>
                    <Td className="text-end tabular-nums">{money(c.budgetMinor, c.currency)}</Td>
                    <Td>
                      <div className="grid gap-1">
                        <span className="text-xs tabular-nums">{money(c.spentMinor, c.currency)}</span>
                        {used != null ? <Meter value={used} label={t("marketing.campaigns.spent")} /> : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={{ q: f.q, status: f.status, sort: f.sort }} page={f.page} total={list.total} pageSize={list.pageSize} t={t} />
      </Card>
    </MarketingShell>
  );
}
