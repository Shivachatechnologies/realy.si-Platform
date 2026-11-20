import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare, RefreshCw, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketingShell, Pager, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip, SmartEmpty } from "@/components/marketing/studio";
import { ReplyEditor } from "@/components/marketing/studio-forms";
import { ActionButton } from "@/components/marketing/ui";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { ENGAGEMENT_STATUSES, listEngagements, parseEngagementFilters } from "@/server/modules/marketing/community";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.community") };
}

const SENT_TONE = { positive: "success", neutral: "neutral", negative: "danger" } as const;

export default async function CommunityPage({ searchParams }: PageProps<"/[locale]/marketing/community">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "community" as const, title: t("marketing.studio.community.title"), subtitle: t("marketing.studio.community.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const f = parseEngagementFilters(await searchParams);
  const [list, help] = await Promise.all([listEngagements(viewer.ctx, org.id, company.id, f), listHelpTasks(org.id, company.id, "community")]);
  const ids = list.data.map((e) => e.id);
  const tasks = ids.length ? await db().agentTask.findMany({ where: { companyId: company.id, subjectType: "marketing_engagement", subjectId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { id: true, subjectId: true, status: true, output: true } }) : [];
  const latest = new Map<string, (typeof tasks)[number]>();
  for (const x of tasks) if (!latest.has(x.subjectId!)) latest.set(x.subjectId!, x);
  const path = `/${locale}/marketing/community`;
  return (
    <MarketingShell {...shell} actions={canManage ? <ActionButton path={`${base}/community/sync`} icon={<RefreshCw aria-hidden />} label={t("marketing.studio.community.sync")} /> : null}>
      <AutoRefresh active={tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING")} />
      <InfoStrip t={t} k="community" />
      <div className="flex flex-wrap gap-2 text-sm">
        {(["negative", "neutral", "positive"] as const).map((s) => (
          <Link key={s} href={`${path}?status=NEW&sentiment=${s}`} className="hover-lift rounded-md border bg-surface px-3 py-2">
            <Badge tone={SENT_TONE[s]}>{t(`marketing.studio.community.sentiment.${s}`)}</Badge> <span className="ms-1 tabular-nums">{list.newBySentiment[s] ?? 0}</span>
          </Link>
        ))}
      </div>
      <Card>
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} aria-label={t("marketing.common.search")} placeholder={t("marketing.common.search")} />
          <Select name="status" defaultValue={f.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("marketing.common.allStatuses")}</option>
            {ENGAGEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.studio.community.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="sentiment" defaultValue={f.sentiment ?? ""} aria-label={t("marketing.studio.community.sentimentLabel")}>
            <option value="">{t("marketing.studio.community.anySentiment")}</option>
            {(["positive", "neutral", "negative"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`marketing.studio.community.sentiment.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("marketing.common.apply")}
          </Button>
        </form>
        {list.data.length === 0 ? (
          <div className="p-4">
            <SmartEmpty icon={<MessagesSquare />} title={t("marketing.studio.community.emptyTitle")} body={t("marketing.studio.community.emptyBody")} action={canManage ? <ActionButton path={`${base}/community/sync`} icon={<RefreshCw aria-hidden />} label={t("marketing.studio.community.sync")} variant="default" /> : undefined} />
          </div>
        ) : (
          <ul className="grid divide-y">
            {list.data.map((e) => {
              const task = latest.get(e.id);
              return (
                <li key={e.id} className="grid gap-2 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge>{t(`marketing.provider.${e.provider}`)}</Badge>
                    {e.sentiment ? <Badge tone={SENT_TONE[e.sentiment as keyof typeof SENT_TONE] ?? "neutral"}>{t(`marketing.studio.community.sentiment.${e.sentiment}`)}</Badge> : null}
                    <StatusBadge status={e.status === "REPLIED" ? "PUBLISHED" : e.status === "IGNORED" ? "CANCELLED" : e.status === "DRAFTED" ? "IN_REVIEW" : "PENDING"} label={t(`marketing.studio.community.status.${e.status}`)} />
                    <span className="font-medium">{e.authorName ?? t("marketing.common.someone")}</span>
                    {e.postedAt ? <span className="text-muted-foreground">{formatDateTime(e.postedAt, locale, tz)}</span> : null}
                  </div>
                  <p className="whitespace-pre-wrap">{e.text}</p>
                  {e.status === "REPLIED" ? (
                    <p className="rounded-md bg-surface-2 p-2 text-xs">
                      {t("marketing.studio.community.replied")}: {e.replyText}
                    </p>
                  ) : canManage ? (
                    <div className="grid gap-2">
                      <ReplyEditor base={base} id={e.id} draft={e.replyDraft} canSend />
                      <div className="flex flex-wrap gap-2">
                        <ActionButton path={`${base}/community/${e.id}`} body={{ action: "ai_draft" }} icon={<Sparkles aria-hidden />} label={t("marketing.studio.community.aiDraft")} variant="ghost" />
                        {task?.status === "COMPLETED" && task.output ? <ActionButton path={`${base}/community/${e.id}/draft`} body={{ text: "", taskId: task.id }} label={t("marketing.studio.community.useAiDraft")} /> : null}
                        {task && (task.status === "QUEUED" || task.status === "RUNNING") ? <span className="text-xs text-muted-foreground">{t("marketing.studio.journey.working")}</span> : null}
                        {e.status !== "IGNORED" ? <ActionButton path={`${base}/community/${e.id}`} body={{ action: "ignore" }} label={t("marketing.studio.community.ignore")} variant="ghost" /> : <ActionButton path={`${base}/community/${e.id}`} body={{ action: "reopen" }} label={t("marketing.studio.community.reopen")} variant="ghost" />}
                      </div>
                      {task?.status === "COMPLETED" && task.output ? <p className="text-xs text-muted-foreground">{t("marketing.studio.community.aiSuggests")}: {task.output.slice(0, 400)}</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Pager path={path} params={{ q: f.q, status: f.status, sentiment: f.sentiment }} page={f.page} total={list.total} pageSize={list.pageSize} t={t} />
      </Card>
      <HelpPanel t={t} base={base} page="community" tasks={help} locale={locale} tz={tz} aiReady={m.aiReady} canRun={m.canRunAgents} />
    </MarketingShell>
  );
}
