import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Plus } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { ActionButton } from "@/components/workforce/action-button";
import { AnswerText } from "@/components/workforce/answer-text";
import { AskCeoForm } from "@/components/workforce/ask-ceo-form";
import { IntelligenceTabs } from "@/components/workforce/intelligence-tabs";
import { PageHeader } from "@/components/workforce/page-header";
import { RenameForm } from "@/components/workforce/rename-form";
import { PageState, Pager, qs } from "@/components/workforce/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { SUGGESTED_QUESTIONS, getConversation, listConversations } from "@/server/modules/workforce/ceo-chat";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("intelligence.chat.title") };
}

/** "Ask the CEO": persisted threads; every question is an AI CEO task whose deliverable is the answer. */
export default async function AskCeoPage({ searchParams }: PageProps<"/[locale]/intelligence/ceo">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <>
      <PageHeader title={t("intelligence.chat.title")} subtitle={t("intelligence.chat.subtitle")} />
      <IntelligenceTabs locale={locale} active="ceo" labels={{ overview: t("intelligence.tabs.overview"), ceo: t("intelligence.tabs.ceo"), growth: t("intelligence.tabs.growth") }} />
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canRun] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const threads = await listConversations(viewer.ctx, org.id, company.id, { q: sp.q, cursor: sp.cursor });
  const current = sp.c
    ? await getConversation(viewer.ctx, org.id, company.id, sp.c).catch((err) => {
        if (isAppError(err) && err.code === "not_found") return null;
        throw err;
      })
    : null;
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = viewer.user.timezone;
  const configured = aiConfigured();
  const suggestions = SUGGESTED_QUESTIONS.map((k) => t(`intelligence.chat.suggestions.${k}`));
  const answeredTasks = new Set(current?.messages.filter((m) => m.role === "ASSISTANT").map((m) => m.taskId) ?? []);
  const pending = !!current?.messages.some((m) => m.role === "USER" && m.task && (m.task.status === "QUEUED" || m.task.status === "RUNNING"));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <AutoRefresh active={pending} intervalMs={4000} />
      {header}
      {!configured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader
            title={t("intelligence.chat.threads")}
            actions={
              <Button asChild size="sm" variant="secondary">
                <Link href={`/${locale}/intelligence/ceo`}>
                  <Plus aria-hidden />
                  {t("intelligence.chat.new")}
                </Link>
              </Button>
            }
          />
          <form method="get" className="px-4 pb-2">
            <label className="sr-only" htmlFor="thread-q">
              {t("intelligence.chat.search")}
            </label>
            <Input id="thread-q" name="q" defaultValue={sp.q ?? ""} placeholder={t("intelligence.chat.search")} className="h-8" />
          </form>
          {threads.data.length === 0 ? (
            <CardBody className="text-sm text-muted-foreground">{sp.q ? t("common.noResults") : t("intelligence.chat.noThreads")}</CardBody>
          ) : (
            <ul className="divide-y text-sm">
              {threads.data.map((c) => (
                <li key={c.id}>
                  <Link href={`/${locale}/intelligence/ceo${qs({ c: c.id, q: sp.q, cursor: sp.cursor })}`} aria-current={current?.id === c.id ? "page" : undefined} className={cn("grid gap-0.5 px-4 py-2 hover:bg-muted/50", current?.id === c.id && "bg-muted")}>
                    <span className="truncate font-medium">{c.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("intelligence.chat.messages", { count: c._count.messages })} · {formatRelativeTime(c.updatedAt, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Pager prevHref={sp.cursor ? `/${locale}/intelligence/ceo${qs({ q: sp.q, c: sp.c })}` : null} nextHref={threads.nextCursor ? `/${locale}/intelligence/ceo${qs({ q: sp.q, c: sp.c, cursor: threads.nextCursor })}` : null} labels={{ previous: t("agentTasks.firstPage"), next: t("common.next") }} />
        </Card>

        <Card>
          {current ? (
            <>
              <CardHeader
                title={current.title}
                description={formatDateTime(current.createdAt, locale, tz)}
                actions={
                  <span className="flex flex-wrap items-center gap-1">
                    <RenameForm path={`${apiBase}/intelligence/conversations/${current.id}`} title={current.title} />
                    <ActionButton path={`${apiBase}/intelligence/conversations/${current.id}`} method="DELETE" variant="ghost" confirm={t("intelligence.chat.confirmArchive")} redirectTo="/intelligence/ceo">
                      <Archive aria-hidden />
                      {t("intelligence.chat.archive")}
                    </ActionButton>
                  </span>
                }
              />
              <CardBody className="grid gap-4">
                <ol className="grid gap-4">
                  {current.messages.map((m) =>
                    m.role === "USER" ? (
                      <li key={m.id} className="grid gap-2">
                        <div className="ms-auto max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm">
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(m.createdAt, locale, tz)}</p>
                        </div>
                        {m.task && !answeredTasks.has(m.task.id) ? (
                          <div className="max-w-[85%] rounded-lg border px-3 py-2 text-sm">
                            {m.task.pendingOutput ? (
                              <AnswerText text={m.task.pendingOutput} locale={locale} />
                            ) : m.task.status === "FAILED" || m.task.status === "CANCELLED" ? (
                              <Notice tone="danger">{t("agentTasks.failed", { message: m.task.errorMessage ?? "" })}</Notice>
                            ) : (
                              <p className="text-muted-foreground">{t("intelligence.chat.thinking")}</p>
                            )}
                            <p className="mt-2 flex items-center gap-2 text-[11px]">
                              <TaskStatusBadge status={m.task.status} label={t(`agentTasks.status.${m.task.status}`)} />
                              <Link className="text-primary hover:underline" href={`/${locale}/tasks/${m.task.id}`}>
                                {t("intelligence.openTask")}
                              </Link>
                            </p>
                          </div>
                        ) : null}
                      </li>
                    ) : (
                      <li key={m.id} className="max-w-[85%] rounded-lg border px-3 py-2">
                        <AnswerText text={m.content} locale={locale} />
                        <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {formatDateTime(m.createdAt, locale, tz)}
                          {m.taskId ? (
                            <Link className="text-primary hover:underline" href={`/${locale}/tasks/${m.taskId}`}>
                              {t("intelligence.chat.sources")}
                            </Link>
                          ) : null}
                          <span>{t("agentTasks.reviewNote")}</span>
                        </p>
                      </li>
                    ),
                  )}
                </ol>
                {canRun && configured ? <AskCeoForm apiBase={apiBase} conversationId={current.id} compact /> : null}
              </CardBody>
            </>
          ) : (
            <>
              <CardHeader title={t("intelligence.chat.new")} description={t("intelligence.chat.newHint")} />
              <CardBody>
                {sp.c ? <Notice tone="warning">{t("intelligence.chat.notFound")}</Notice> : null}
                {canRun && configured ? <AskCeoForm apiBase={apiBase} suggestions={suggestions} /> : <p className="text-sm text-muted-foreground">{configured ? t("errors.forbidden") : t("agentTasks.notConfigured")}</p>}
              </CardBody>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
