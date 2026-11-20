import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { NewContentForm } from "@/components/marketing/content-forms";
import { MarketingShell, Pager, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { getT } from "@/i18n/server";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { CONTENT_STATUSES, CONTENT_TYPES, listContent, parseContentFilters } from "@/server/modules/marketing/content";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.content") };
}

export default async function ContentLibraryPage({ searchParams }: PageProps<"/[locale]/marketing/content">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const path = `/${locale}/marketing/content`;
  const shell = {
    locale,
    t,
    tab: "content" as const,
    title: t("marketing.content.title"),
    subtitle: t("marketing.content.subtitle"),
    actions: (
      <Button asChild variant="secondary" size="sm">
        <Link href={`${path}/calendar`}>
          <CalendarDays aria-hidden />
          {t("marketing.content.calendar")}
        </Link>
      </Button>
    ),
  };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const f = parseContentFilters(await searchParams);
  const [list, campaigns] = await Promise.all([listContent(viewer.ctx, org.id, company.id, f), campaignOptions(viewer.ctx, org.id, company.id)]);
  const filtered = !!(f.q || f.type || f.status || f.campaignId);

  return (
    <MarketingShell {...shell}>
      <div className="flex flex-wrap gap-2">
        {CONTENT_STATUSES.map((s) => (
          <Link key={s} href={`${path}?status=${s}`} className="flex items-center gap-2 rounded-md border bg-surface px-3 py-2 text-sm hover:bg-muted">
            <StatusBadge status={s} label={t(`marketing.contentStatus.${s}`)} />
            <span className="tabular-nums">{list.byStatus[s] ?? 0}</span>
          </Link>
        ))}
      </div>
      {canManage ? (
        <Card>
          <details open={!!f.campaignId && list.total === 0}>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.content.create")}</summary>
            <NewContentForm base={base} locale={locale} campaigns={campaigns} defaultCampaignId={f.campaignId} />
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("marketing.content.library")} description={t("marketing.common.count", { count: list.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_9rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} aria-label={t("marketing.common.search")} placeholder={t("marketing.content.searchPlaceholder")} />
          <Select name="type" defaultValue={f.type ?? ""} aria-label={t("marketing.content.type")}>
            <option value="">{t("marketing.content.allTypes")}</option>
            {CONTENT_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`marketing.contentType.${x}`)}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={f.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("marketing.common.allStatuses")}</option>
            {CONTENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.contentStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="campaign" defaultValue={f.campaignId ?? ""} aria-label={t("marketing.campaigns.campaign")}>
            <option value="">{t("marketing.campaigns.allCampaigns")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={f.sort ?? "updated"} aria-label={t("marketing.common.sort")}>
            <option value="updated">{t("marketing.common.sortUpdated")}</option>
            <option value="title">{t("marketing.common.sortName")}</option>
            <option value="scheduled">{t("marketing.content.sortScheduled")}</option>
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
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("marketing.content.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.content.titleLabel")}</Th>
                <Th>{t("marketing.content.type")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("marketing.campaigns.campaign")}</Th>
                <Th>{t("marketing.content.when")}</Th>
                <Th>{t("marketing.common.updated")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`${path}/${c.id}`} className="font-medium hover:underline">
                      {c.title}
                    </Link>
                    <span className="ms-2 text-[11px] text-muted-foreground">v{c.version}</span>
                  </Td>
                  <Td className="text-xs">{t(`marketing.contentType.${c.type}`)}</Td>
                  <Td>
                    <StatusBadge status={c.status} label={t(`marketing.contentStatus.${c.status}`)} />
                  </Td>
                  <Td className="text-xs text-muted-foreground">{c.campaign?.name ?? "—"}</Td>
                  <Td className="text-xs text-muted-foreground">{c.publishedAt ? formatDateTime(c.publishedAt, locale, tz) : c.scheduledAt ? formatDateTime(c.scheduledAt, locale, tz) : "—"}</Td>
                  <Td className="text-xs text-muted-foreground">{formatRelativeTime(c.updatedAt, locale)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={{ q: f.q, type: f.type, status: f.status, campaign: f.campaignId, sort: f.sort }} page={f.page} total={list.total} pageSize={list.pageSize} t={t} />
      </Card>
    </MarketingShell>
  );
}
