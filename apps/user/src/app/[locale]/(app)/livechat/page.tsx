import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Handshake, LifeBuoy, MessagesSquare, UserRound } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { buttonVariants } from "@/components/ui/button";
import { LiveRefresh } from "@/components/livechat/live-refresh";
import { OutcomeBadges, StatusBadge, TrendBars } from "@/components/livechat/bits";
import { livechatPage } from "@/components/livechat/context";
import { getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { db } from "@/server/core/db";
import { ensureSettings } from "@/server/modules/livechat/common";
import { knowledgeGaps, listConversations, livechatAnalytics } from "@/server/modules/livechat/inbox";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("livechat.title") };
}

const FILTERS = ["open", "waiting", "ai", "human", "closed", "all"] as const;

export default async function LivechatInboxPage({ searchParams }: PageProps<"/[locale]/livechat">) {
  const sp = await searchParams;
  const p = await livechatPage("inbox");
  if (p.gate) return p.gate;
  const { org, company, viewer, locale, t, perms, aiReady, wrap } = p;
  const [list, analytics, gaps, settings] = await Promise.all([
    listConversations(viewer.ctx, org.id, company.id, { status: sp.status, q: sp.q, page: sp.page }),
    livechatAnalytics(viewer.ctx, org.id, company.id, 30),
    knowledgeGaps(viewer.ctx, org.id, company.id),
    ensureSettings(db(), org.id, company.id),
  ]);
  const path = `/${locale}/livechat`;
  const f = list.filters;
  const href = (o: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const next = { status: f.status === "open" ? undefined : f.status, q: f.q, ...o };
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== "" && !(k === "page" && String(v) === "1")) q.set(k, String(v));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const counts: Record<(typeof FILTERS)[number], number> = {
    open: list.counts.AI_ACTIVE + list.counts.WAITING_HUMAN + list.counts.HUMAN_ACTIVE,
    waiting: list.counts.WAITING_HUMAN,
    ai: list.counts.AI_ACTIVE,
    human: list.counts.HUMAN_ACTIVE,
    closed: list.counts.CLOSED,
    all: Object.values(list.counts).reduce((a, b) => a + b, 0),
  };
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  return wrap(
    <>
      <LiveRefresh seconds={10} />
      {!settings.enabled ? (
        <Notice
          tone="info"
          title={t("livechat.setup.offTitle")}
          action={perms.manage ? <Link href={`${path}/settings`} className={buttonVariants({ size: "sm" })}>{t("livechat.setup.cta")}</Link> : undefined}
        >
          {t("livechat.setup.offBody")}
        </Notice>
      ) : null}
      {!aiReady ? <Notice tone="warning" title={t("livechat.aiMissingTitle")}>{t("livechat.aiMissingBody")}</Notice> : null}
      {list.counts.WAITING_HUMAN ? (
        <Notice tone="warning" title={t("livechat.waitingTitle", { count: list.counts.WAITING_HUMAN })} action={<Link href={href({ status: "waiting", page: undefined })} className={buttonVariants({ size: "sm", variant: "secondary" })}>{t("livechat.waitingCta")}</Link>}>
          {t("livechat.waitingBody")}
        </Notice>
      ) : null}

      <section aria-labelledby="lc-analytics" className="grid gap-3">
        <h2 id="lc-analytics" className="text-sm font-medium text-muted-foreground">{t("livechat.analytics.title", { days: analytics.days })}</h2>
        <StatGrid>
          <StatTile index={0} label={t("livechat.analytics.conversations")} value={analytics.total} format="integer" icon={<MessagesSquare className="size-4" />} live />
          <StatTile index={1} label={t("livechat.analytics.aiResolution")} value={analytics.resolutionRate === null ? "—" : analytics.resolutionRate / 100} format="percent" hint={t("livechat.analytics.aiResolutionHint", { resolved: analytics.aiResolved, closed: analytics.closed })} icon={<Bot className="size-4" />} />
          <StatTile index={2} label={t("livechat.analytics.leads")} value={analytics.leads} format="integer" hint={analytics.meetings ? t("livechat.analytics.meetings", { count: analytics.meetings }) : undefined} icon={<Handshake className="size-4" />} />
          <StatTile index={3} label={t("livechat.analytics.handoffs")} value={analytics.handoffs} format="integer" hint={t("livechat.analytics.tickets", { count: analytics.tickets })} icon={<LifeBuoy className="size-4" />} />
        </StatGrid>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("livechat.analytics.trendTitle")} description={t("livechat.analytics.trendHint")} />
          <CardBody>
            {analytics.total ? (
              <TrendBars series={analytics.series} label={t("livechat.analytics.conversations")} resolvedLabel={t("livechat.analytics.resolvedByAi")} locale={locale} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("livechat.analytics.empty")}</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("livechat.gaps.title")} description={t("livechat.gaps.hint")} />
          <CardBody>
            {gaps.length ? (
              <ul className="grid gap-2 text-sm">
                {gaps.map((g) => (
                  <li key={g.id}>
                    <Link href={`${path}/${g.id}`} className="line-clamp-2 underline-offset-2 hover:underline">{g.handoffReason ?? t("livechat.gaps.unknown")}</Link>
                    {g.handoffAt ? <span className="text-xs text-muted-foreground">{formatRelativeTime(g.handoffAt, locale)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("livechat.gaps.empty")}</p>
            )}
            {perms.manage && gaps.length ? (
              <Link href={`/${locale}/support/knowledge`} className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-3")}>{t("livechat.gaps.addArticle")}</Link>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <div className="grid gap-3 border-b p-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
          <nav className="flex gap-1 overflow-x-auto" aria-label={t("livechat.filters.label")}>
            {FILTERS.map((k) => (
              <Link key={k} href={href({ status: k === "open" ? undefined : k, page: undefined })} aria-current={f.status === k ? "page" : undefined} className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", f.status === k ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
                {t(`livechat.filters.${k}`)}
                <span className={cn("text-xs tabular-nums", k === "waiting" && counts[k] ? "text-warning" : "")}>{counts[k]}</span>
              </Link>
            ))}
          </nav>
          <form action={path} role="search">
            {f.status !== "open" ? <input type="hidden" name="status" value={f.status} /> : null}
            <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={100} placeholder={t("livechat.search")} aria-label={t("livechat.search")} />
          </form>
        </div>
        {list.data.length ? (
          <ul className="divide-y">
            {list.data.map((c) => (
              <li key={c.id}>
                <Link href={`${path}/${c.id}`} className={cn("grid gap-1 p-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4", c.status === "WAITING_HUMAN" && "bg-warning/5")}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <UserRound className="size-4 text-muted-foreground" aria-hidden />
                      <span className="font-medium">{c.visitor.name ?? t("livechat.anonymous")}</span>
                      <StatusBadge status={c.status} t={t} />
                      <OutcomeBadges outcomes={c.outcomes} t={t} />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {c.last ? `${t(`livechat.authors.${c.last.author}`)}: ${c.last.body}` : t("livechat.noMessages")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground sm:flex-col sm:items-end sm:gap-1">
                    <time dateTime={c.lastMessageAt.toISOString()}>{formatRelativeTime(c.lastMessageAt, locale)}</time>
                    <span>{t("livechat.messageCount", { count: c.messageCount })}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid justify-items-center gap-2 p-8 text-center">
            <MessagesSquare className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">{f.q || f.status !== "open" ? t("livechat.emptyFiltered") : t("livechat.empty")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{settings.enabled ? t("livechat.emptyHint") : t("livechat.emptyHintOff")}</p>
          </div>
        )}
        {pages > 1 ? (
          <nav className="flex items-center justify-between border-t p-3 text-sm" aria-label={t("livechat.pager")}>
            {f.page > 1 ? <Link href={href({ page: f.page - 1 })} className="underline">{t("common.previous")}</Link> : <span />}
            <span className="text-muted-foreground">{t("livechat.page", { page: f.page, pages })}</span>
            {f.page < pages ? <Link href={href({ page: f.page + 1 })} className="underline">{t("common.next")}</Link> : <span />}
          </nav>
        ) : null}
      </Card>
    </>,
  );
}
