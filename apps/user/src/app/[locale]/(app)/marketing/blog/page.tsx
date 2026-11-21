import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, FileText, Plus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { MarketingShell, Pager, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip, SmartEmpty } from "@/components/marketing/studio";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { blogOverview } from "@/server/modules/marketing/blog";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";
import { pageParam, param } from "@/server/modules/marketing/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.blog") };
}

export default async function BlogPage({ searchParams }: PageProps<"/[locale]/marketing/blog">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "blog" as const, title: t("marketing.studio.blog.title"), subtitle: t("marketing.studio.blog.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, tz } = m;
  const sp = await searchParams;
  const q = param(sp, "q");
  const page = pageParam(sp);
  const [o, help] = await Promise.all([blogOverview(viewer.ctx, org.id, company.id, q, page), listHelpTasks(org.id, company.id, "blog")]);
  const path = `/${locale}/marketing/blog`;
  const publicUrl = `/${locale}/blog/${company.id}`;
  return (
    <MarketingShell
      {...shell}
      actions={
        <>
          <Link href={publicUrl} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent" target="_blank">
            <ExternalLink className="size-4" aria-hidden />
            {t("marketing.studio.blog.openPublic")}
          </Link>
          <Link href={`/${locale}/marketing/content?type=BLOG`} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            <Plus className="size-4" aria-hidden />
            {t("marketing.studio.blog.write")}
          </Link>
        </>
      }
    >
      <InfoStrip t={t} k="blog" />
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile index={0} label={t("marketing.studio.blog.publicPosts")} value={o.publicPosts} />
        <StatTile index={1} label={t("marketing.studio.blog.views")} value={o.totalViews} />
        {(["wordpress", "webflow", "shopify"] as const).map((p, i) => (
          <StatTile key={p} index={i + 2} label={t(`marketing.studio.publish.targets.${p}`)} value={o.cms[p] ? t("marketing.social.connected") : t("common.notConnected")} href={`/${locale}/integrations/${p}`} />
        ))}
      </div>
      <Card>
        <CardHeader title={t("marketing.studio.blog.articles")} description={t("marketing.studio.blog.articlesHint")} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_auto]" action={path}>
          <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} aria-label={t("marketing.common.search")} placeholder={t("marketing.common.search")} />
          <Button type="submit" variant="secondary">
            {t("marketing.common.apply")}
          </Button>
        </form>
        {o.articles.length === 0 ? (
          <div className="p-4">
            <SmartEmpty icon={<FileText />} title={t("marketing.studio.blog.emptyTitle")} body={t("marketing.studio.blog.emptyBody")} action={<Link href={`/${locale}/marketing/seo`} className="rounded-md border px-3 py-2 text-sm hover:bg-accent">{t("marketing.studio.blog.fromSeo")}</Link>} />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.content.titleLabel")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("marketing.studio.blog.published")}</Th>
                <Th className="text-end">{t("marketing.studio.blog.views")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.articles.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <Link href={`/${locale}/marketing/content/${a.id}`} className="font-medium hover:underline">
                      {a.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {t(`marketing.contentType.${a.type}`)}
                      {a.categories.length ? ` · ${a.categories.join(", ")}` : ""} · v{a.version}
                    </p>
                  </Td>
                  <Td>
                    <StatusBadge status={a.status} label={t(`marketing.contentStatus.${a.status}`)} />
                  </Td>
                  <Td className="text-xs">
                    <ul className="grid gap-0.5">
                      {a.cmsPublications.map((p, i) => (
                        <li key={i} className={p.status === "FAILED" ? "text-danger" : ""}>
                          {t(`marketing.studio.publish.targets.${p.provider}`)}: {p.url ? <a href={p.url} className="underline" target="_blank" rel="noreferrer">{p.status}</a> : p.status}
                          {p.error ? ` (${p.error})` : ""}
                        </li>
                      ))}
                      {a.scheduledAt && a.status === "SCHEDULED" ? <li>{formatDateTime(a.scheduledAt, locale, tz)}</li> : null}
                    </ul>
                  </Td>
                  <Td className="text-end tabular-nums">{a.views}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={{ q }} page={page} total={o.total} pageSize={o.pageSize} t={t} />
      </Card>
      <HelpPanel t={t} base={base} page="blog" tasks={help} locale={locale} tz={tz} aiReady={m.aiReady} canRun={m.canRunAgents} />
    </MarketingShell>
  );
}
