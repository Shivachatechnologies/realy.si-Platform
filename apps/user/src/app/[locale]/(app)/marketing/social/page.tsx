import type { Metadata } from "next";
import Link from "next/link";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AccountForm, PostComposer } from "@/components/marketing/social-forms";
import { MarketingShell, Pager, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { accountChoices, listAccounts, listPosts, parsePostFilters, POST_STATUSES, SOCIAL_PROVIDERS } from "@/server/modules/marketing/social";
import { assetOptions } from "@/server/modules/marketing/assets";
import { listHashtagSets, listHelpTasks } from "@/server/modules/marketing/intelligence";
import { HashtagSetForm } from "@/components/marketing/studio-forms";
import { HelpPanel, InfoStrip } from "@/components/marketing/studio";
import { db } from "@/server/core/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.social") };
}

export default async function SocialPage({ searchParams }: PageProps<"/[locale]/marketing/social">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "social" as const, title: t("marketing.social.title"), subtitle: t("marketing.social.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const f = parsePostFilters(await searchParams);
  const [{ accounts, connected }, posts, campaigns, choices, assets, hashtagSets, statusCounts, help] = await Promise.all([
    listAccounts(viewer.ctx, org.id, company.id),
    listPosts(viewer.ctx, org.id, company.id, f),
    campaignOptions(viewer.ctx, org.id, company.id),
    accountChoices(viewer.ctx, org.id, company.id),
    assetOptions(viewer.ctx, org.id, company.id),
    listHashtagSets(viewer.ctx, org.id, company.id),
    db().marketingSocialPost.groupBy({ by: ["status"], where: { organizationId: org.id, companyId: company.id }, _count: { _all: true } }),
    listHelpTasks(org.id, company.id, "social"),
  ]);
  const byStatus = Object.fromEntries(statusCounts.map((x) => [x.status, x._count._all])) as Record<string, number>;
  const path = `/${locale}/marketing/social`;
  const filtered = !!(f.q || f.status);
  const anyDisconnected = SOCIAL_PROVIDERS.some((p) => !connected[p]);

  return (
    <MarketingShell {...shell}>
      <InfoStrip t={t} k="social" />
      <nav className="stagger grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label={t("marketing.studio.social.board")}>
        {POST_STATUSES.map((st) => (
          <Link key={st} href={`${path}?status=${st}`} aria-current={f.status === st ? "page" : undefined} className={`hover-lift grid gap-0.5 rounded-md border bg-surface p-2 text-center ${f.status === st ? "border-primary" : ""}`}>
            <span className="text-lg font-semibold tabular-nums">{byStatus[st] ?? 0}</span>
            <span className="text-[11px] text-muted-foreground">{t(`marketing.postStatus.${st}`)}</span>
          </Link>
        ))}
      </nav>
      {anyDisconnected ? (
        <Notice tone="info">
          {t("marketing.social.connectHint")}{" "}
          <Link href={`/${locale}/integrations`} className="font-medium underline">
            {t("marketing.common.openIntegrations")}
          </Link>
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("marketing.social.newPost")} description={t("marketing.social.newPostHint")} />
          {canManage ? (
            <PostComposer base={base} locale={locale} accounts={accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider, connected: a.connected }))} campaigns={campaigns} assets={assets} hashtagSets={hashtagSets} />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("errors.forbidden")}</p>
          )}
        </Card>
        <Card>
          <CardHeader title={t("marketing.social.accounts")} />
          <ul className="grid divide-y">
            {SOCIAL_PROVIDERS.map((p) => (
              <li key={p} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>{t(`marketing.provider.${p}`)}</span>
                <StatusBadge status={connected[p] ? "ACTIVE" : "PAUSED"} label={connected[p] ? t("marketing.social.connected") : t("common.notConnected")} />
              </li>
            ))}
          </ul>
          <div className="border-t">
            {accounts.length === 0 ? <p className="p-4 text-xs text-muted-foreground">{t("marketing.social.noAccounts")}</p> : null}
            <ul className="grid divide-y">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t(`marketing.provider.${a.provider}`)}
                      {a.handle ? ` · ${a.handle}` : ""}
                    </p>
                  </div>
                  {canManage ? <ActionButton path={`${base}/social/accounts/${a.id}`} method="DELETE" variant="ghost" icon={<Archive aria-hidden />} label={<span className="sr-only">{t("marketing.common.archive")}</span>} confirm={t("marketing.common.confirmArchive")} /> : null}
                </li>
              ))}
            </ul>
          </div>
          {canManage ? (
            <details className="border-t">
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.social.addAccount")}</summary>
              <AccountForm base={base} choices={choices} />
            </details>
          ) : null}
          <div className="border-t">
            <p className="px-4 pt-3 text-sm font-medium">{t("marketing.studio.hashtags.title")}</p>
            <ul className="grid gap-1 px-4 py-2 text-xs">
              {hashtagSets.length === 0 ? <li className="text-muted-foreground">{t("marketing.studio.hashtags.empty")}</li> : null}
              {hashtagSets.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <strong>{h.name}</strong> {h.tags.join(" ")}
                  </span>
                  {canManage ? <ActionButton path={`${base}/hashtag-sets/${h.id}`} method="DELETE" variant="ghost" label={t("marketing.common.delete")} confirm={t("marketing.common.confirmDelete")} /> : null}
                </li>
              ))}
            </ul>
            {canManage ? <HashtagSetForm base={base} /> : null}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("marketing.social.queue")} description={t("marketing.common.count", { count: posts.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} aria-label={t("marketing.common.search")} placeholder={t("marketing.social.searchPlaceholder")} />
          <Select name="status" defaultValue={f.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("marketing.common.allStatuses")}</option>
            {POST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.postStatus.${s}`)}
              </option>
            ))}
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
        {posts.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("marketing.social.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.social.post")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("marketing.social.platforms")}</Th>
                <Th>{t("marketing.content.when")}</Th>
                <Th className="text-end">{t("marketing.commandCenter.engagement")}</Th>
              </Tr>
            </THead>
            <TBody>
              {posts.data.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`${path}/${p.id}`} className="font-medium hover:underline">
                      {p.title}
                    </Link>
                    <p className="line-clamp-1 max-w-md text-xs text-muted-foreground">{p.text}</p>
                  </Td>
                  <Td>
                    <StatusBadge status={p.status} label={t(`marketing.postStatus.${p.status}`)} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {p.targets.map((x) => (
                        <StatusBadge key={x.id} status={x.status === "PUBLISHED" ? "PUBLISHED" : x.status === "FAILED" ? "FAILED" : "PENDING"} label={t(`marketing.provider.${x.account.provider}`)} />
                      ))}
                    </div>
                  </Td>
                  <Td className="text-xs text-muted-foreground">{p.publishedAt ? formatDateTime(p.publishedAt, locale, tz) : p.scheduledAt ? formatDateTime(p.scheduledAt, locale, tz) : "—"}</Td>
                  <Td className="text-end tabular-nums">{p.targets.reduce((s, x) => s + (x.likes ?? 0) + (x.comments ?? 0) + (x.shares ?? 0), 0)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={{ q: f.q, status: f.status }} page={f.page} total={posts.total} pageSize={posts.pageSize} t={t} />
      </Card>
      <HelpPanel t={t} base={base} page="social" tasks={help} locale={locale} tz={tz} aiReady={m.aiReady} canRun={m.canRunAgents} />
    </MarketingShell>
  );
}
