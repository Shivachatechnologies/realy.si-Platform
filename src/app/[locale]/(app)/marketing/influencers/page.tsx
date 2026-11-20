import type { Metadata } from "next";
import { Send, Sparkles, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketingShell, Pager, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip, SmartEmpty } from "@/components/marketing/studio";
import { InfluencerForm } from "@/components/marketing/studio-forms";
import { ActionButton } from "@/components/marketing/ui";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { INFLUENCER_STATUSES, listInfluencers, parseInfluencerFilters } from "@/server/modules/marketing/community";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.influencers") };
}

export default async function InfluencersPage({ searchParams }: PageProps<"/[locale]/marketing/influencers">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "influencers" as const, title: t("marketing.studio.influencers.title"), subtitle: t("marketing.studio.influencers.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const f = parseInfluencerFilters(await searchParams);
  const [list, help] = await Promise.all([listInfluencers(viewer.ctx, org.id, company.id, f), listHelpTasks(org.id, company.id, "influencers")]);
  const ids = list.data.map((x) => x.id);
  const tasks = ids.length ? await db().agentTask.findMany({ where: { companyId: company.id, subjectType: "marketing_influencer", subjectId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { id: true, subjectId: true, status: true } }) : [];
  const latest = new Map<string, (typeof tasks)[number]>();
  for (const x of tasks) if (!latest.has(x.subjectId!)) latest.set(x.subjectId!, x);
  const path = `/${locale}/marketing/influencers`;
  return (
    <MarketingShell {...shell}>
      <AutoRefresh active={tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING")} />
      <InfoStrip t={t} k="influencers" />
      {canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-4 font-medium">{t("marketing.studio.influencers.add")}</summary>
            <InfluencerForm base={base} />
          </details>
        </Card>
      ) : null}
      <Card>
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} aria-label={t("marketing.common.search")} placeholder={t("marketing.common.search")} />
          <Select name="status" defaultValue={f.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("marketing.common.allStatuses")}</option>
            {INFLUENCER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.studio.influencers.status.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("marketing.common.apply")}
          </Button>
        </form>
        {list.data.length === 0 ? (
          <div className="p-4">
            <SmartEmpty icon={<Users />} title={t("marketing.studio.influencers.emptyTitle")} body={t("marketing.studio.influencers.emptyBody")} />
          </div>
        ) : (
          <ul className="grid divide-y">
            {list.data.map((r) => {
              const task = latest.get(r.id);
              return (
                <li key={r.id} className="grid gap-2 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge>{r.platform}</Badge>
                    {r.handle ? <span className="text-muted-foreground">{r.handle}</span> : null}
                    {r.followers != null ? <span className="text-xs text-muted-foreground">{t("marketing.studio.influencers.followersN", { count: formatNumber(r.followers, locale) })}</span> : null}
                    <Badge tone="info">{t(`marketing.studio.influencers.status.${r.status}`)}</Badge>
                    {r.outreachStatus ? <Badge tone={r.outreachStatus === "SENT" ? "success" : r.outreachStatus === "FAILED" ? "danger" : "warning"}>{t(`marketing.studio.influencers.outreach.${r.outreachStatus}`)}</Badge> : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <ActionButton path={`${base}/influencers/${r.id}/outreach`} body={{ action: "draft" }} icon={<Sparkles aria-hidden />} label={t("marketing.studio.influencers.aiDraft")} variant="ghost" />
                      {task?.status === "COMPLETED" ? <ActionButton path={`${base}/influencers/${r.id}/outreach`} body={{ action: "apply", taskId: task.id }} label={t("marketing.studio.influencers.useDraft")} /> : null}
                      {r.outreachDraft && r.email && r.outreachStatus !== "SENT" && r.outreachStatus !== "PENDING_APPROVAL" ? <ActionButton path={`${base}/influencers/${r.id}/outreach`} body={{ action: "send" }} icon={<Send aria-hidden />} label={t("marketing.studio.influencers.requestSend")} /> : null}
                      <ActionButton path={`${base}/influencers/${r.id}`} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} />
                    </div>
                  ) : null}
                  {canManage ? (
                    <details>
                      <summary className="cursor-pointer text-xs">{t("marketing.studio.influencers.edit")}</summary>
                      <InfluencerForm base={base} initial={r} />
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Pager path={path} params={{ q: f.q, status: f.status }} page={f.page} total={list.total} pageSize={list.pageSize} t={t} />
      </Card>
      <HelpPanel t={t} base={base} page="influencers" tasks={help} locale={locale} tz={tz} aiReady={m.aiReady} canRun={m.canRunAgents} />
    </MarketingShell>
  );
}
