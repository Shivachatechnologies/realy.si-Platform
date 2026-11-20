import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AiRequest, ApplyAi } from "@/components/marketing/ai-panel";
import { AiTaskList } from "@/components/marketing/ai-tasks";
import { CommentForm, ContentEditor, DistributeForm, MetaEditor, WorkflowActions } from "@/components/marketing/content-forms";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { isoToLocalInput } from "@/components/marketing/format";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { getContent } from "@/server/modules/marketing/content";
import { listAccounts } from "@/server/modules/marketing/social";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.content") };
}

const COMMENT_TONE: Record<string, string> = { approved: "text-success", changes_requested: "text-warning", submitted: "text-primary", published: "text-success" };

export default async function ContentPage({ params }: PageProps<"/[locale]/marketing/content/[contentId]">) {
  const { contentId } = await params;
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/content`, label: t("marketing.content.title") };
  if (m.blocked) return <MarketingShell locale={locale} t={t} tab="content" title={t("marketing.content.title")} back={back} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, canRunAgents, tz } = m;
  const c = await getContent(viewer.ctx, org.id, company.id, contentId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const [campaigns, tasks, social] = await Promise.all([
    campaignOptions(viewer.ctx, org.id, company.id),
    listSubjectTasks(viewer.ctx, org.id, company.id, "marketing_content", c.id).catch(() => []),
    canManage ? listAccounts(viewer.ctx, org.id, company.id) : Promise.resolve({ accounts: [] }),
  ]);
  const archived = !!c.archivedAt;
  const editable = canManage && !archived && c.status !== "PUBLISHED";
  const path = `${base}/content/${c.id}`;
  const draftTasks = tasks.filter((x) => !x.title.startsWith("SEO meta:"));
  const metaTasks = tasks.filter((x) => x.title.startsWith("SEO meta:"));

  return (
    <MarketingShell
      locale={locale}
      t={t}
      tab="content"
      back={back}
      title={c.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={c.status} label={t(`marketing.contentStatus.${c.status}`)} />
          <span className="text-xs">{t(`marketing.contentType.${c.type}`)}</span>
          <span className="text-xs">v{c.version}</span>
          {c.campaign ? (
            <Link href={`/${locale}/marketing/campaigns/${c.campaign.id}`} className="text-xs hover:underline">
              · {c.campaign.name}
            </Link>
          ) : null}
          {c.scheduledAt && c.status === "SCHEDULED" ? <span className="text-xs">· {t("marketing.content.scheduledFor", { date: formatDateTime(c.scheduledAt, locale, tz) })}</span> : null}
          {c.publishedAt ? <span className="text-xs">· {t("marketing.content.publishedOn", { date: formatDateTime(c.publishedAt, locale, tz) })}</span> : null}
        </span>
      }
      actions={canManage && !archived ? <ActionButton path={path} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} redirectTo={back.href} /> : null}
    >
      {c.publishedUrl ? (
        <Notice tone="success">
          <a href={c.publishedUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {c.publishedUrl}
          </a>
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader title={t("marketing.content.editor")} description={c.approvedByName ? t("marketing.content.approvedBy", { name: c.approvedByName }) : undefined} />
            <ContentEditor
              base={base}
              readOnly={!editable}
              campaigns={campaigns}
              content={{ id: c.id, type: c.type, title: c.title, body: c.body, brief: c.brief ?? "", campaignId: c.campaignId ?? "", status: c.status }}
            />
          </Card>
          <Card>
            <CardHeader title={t("marketing.ai.contentTitle")} description={t("marketing.ai.contentHint")} />
            <div className="grid gap-3 p-4">
              {canRunAgents && editable ? <AiRequest path={`${path}/ai`} kind="content_draft" label={t("marketing.ai.generateDraft")} notePlaceholder={t("marketing.ai.notePlaceholder")} /> : null}
              <AiTaskList
                tasks={draftTasks}
                locale={locale}
                tz={tz}
                t={t}
                aiReady={m.aiReady}
                action={editable ? (task) => <ApplyAi path={`${path}/apply-ai`} taskId={task.id} target="body" label={t("marketing.ai.useDraft")} /> : undefined}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title={t("marketing.seo.metaEditor")} description={t("marketing.seo.metaEditorHint")} />
            <MetaEditor base={base} readOnly={!canManage || archived} content={{ id: c.id, slug: c.slug ?? "", metaTitle: c.metaTitle ?? "", metaDescription: c.metaDescription ?? "", keywords: c.keywords }} />
            <div className="grid gap-3 border-t p-4">
              {canRunAgents && !archived ? <AiRequest path={`${path}/ai`} kind="content_meta" label={t("marketing.ai.generateMeta")} /> : null}
              {metaTasks.length ? (
                <AiTaskList
                  tasks={metaTasks}
                  locale={locale}
                  tz={tz}
                  t={t}
                  aiReady={m.aiReady}
                  action={canManage && !archived ? (task) => <ApplyAi path={`${path}/apply-ai`} taskId={task.id} target="meta" label={t("marketing.ai.useMeta")} /> : undefined}
                />
              ) : null}
            </div>
          </Card>
        </div>
        <div className="grid content-start gap-4">
          {canManage && !archived && c.status !== "PUBLISHED" ? (
            <Card>
              <CardHeader title={t("marketing.content.workflow")} description={t(`marketing.content.workflowHint.${c.status}`)} />
              <WorkflowActions base={base} contentId={c.id} status={c.status} scheduledAt={isoToLocalInput(c.scheduledAt)} />
            </Card>
          ) : null}
          {canManage && !archived && ["APPROVED", "SCHEDULED", "PUBLISHED"].includes(c.status) ? (
            <Card>
              <CardHeader title={t("marketing.content.distributeTitle")} description={t("marketing.content.distributeHint")} />
              <DistributeForm base={base} locale={locale} contentId={c.id} accounts={social.accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider, connected: a.connected }))} />
            </Card>
          ) : null}
          {c.socialPosts.length ? (
            <Card>
              <CardHeader title={t("marketing.content.posts")} />
              <ul className="grid divide-y text-sm">
                {c.socialPosts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <Link href={`/${locale}/marketing/social/${p.id}`} className="truncate hover:underline">
                      {p.title}
                    </Link>
                    <StatusBadge status={p.status} label={t(`marketing.postStatus.${p.status}`)} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("marketing.content.comments")} />
            {c.comments.length === 0 ? <p className="p-4 text-xs text-muted-foreground">{t("marketing.content.noComments")}</p> : null}
            <ul className="grid divide-y">
              {c.comments.map((x) => (
                <li key={x.id} className="grid gap-1 px-4 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{x.authorName ?? t("marketing.common.someone")}</span>
                    <span className={COMMENT_TONE[x.kind] ?? ""}>{t(`marketing.content.commentKind.${x.kind}`)}</span>
                    <span>{formatDateTime(x.createdAt, locale, tz)}</span>
                  </div>
                  {x.body ? <p className="whitespace-pre-wrap">{x.body}</p> : null}
                </li>
              ))}
            </ul>
            <CommentForm base={base} contentId={c.id} />
          </Card>
          <Card>
            <CardHeader title={t("marketing.content.versions")} />
            <ul className="grid divide-y">
              {c.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <details className="min-w-0 flex-1">
                    <summary className="cursor-pointer">
                      v{v.version} · {t(`marketing.content.versionSource.${v.source}`)} · <span className="text-xs text-muted-foreground">{v.authorName ?? ""} {formatDateTime(v.createdAt, locale, tz)}</span>
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 font-sans text-xs">{v.body || "—"}</pre>
                  </details>
                  {editable && v.version !== c.version ? <ActionButton path={`${path}/workflow`} body={{ action: "restore", version: v.version }} variant="ghost" label={t("marketing.content.restore")} confirm={t("marketing.content.confirmRestore")} /> : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </MarketingShell>
  );
}
