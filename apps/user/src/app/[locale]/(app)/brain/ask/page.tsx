import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { AskBrain } from "@/components/brain/ask-brain";
import { BrainTabs } from "@/components/brain/brain-tabs";
import { CitationList } from "@/components/brain/citation-list";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { listQuestions } from "@/server/modules/brain/ask";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("brain.ask.title") };
}

export default async function AskBrainPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <PageHeader variant="editorial" world="brain" eyebrow={t("dna.worlds.brain")} title={t("modules.brain.title")} description={t("brain.ask.subtitle")} />
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-4xl gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canRun, canReadTasks] = await Promise.all([can(viewer.ctx, "brain.read", chain), can(viewer.ctx, "agents.run", chain), can(viewer.ctx, "agents.read", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-4xl gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const questions = canReadTasks ? await listQuestions(viewer.ctx, org.id, company.id) : [];
  const tz = viewer.user.timezone;

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <AutoRefresh active={questions.some((q) => q.status === "QUEUED" || q.status === "RUNNING")} intervalMs={4000} />
      {header}
      <BrainTabs locale={locale} active="ask" />
      {!aiConfigured() ? (
        <Notice tone="warning">{t("brain.ask.notConfigured")}</Notice>
      ) : !canRun ? (
        <Notice tone="warning">{t("brain.ask.noPermission")}</Notice>
      ) : (
        <AskBrain organizationId={org.id} companyId={company.id} refreshOnDone />
      )}

      {canReadTasks ? (
        <Card>
          <CardHeader title={t("brain.ask.history")} description={t("brain.ask.historyCount", { count: questions.length })} />
          {questions.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("brain.ask.empty")}</p>
          ) : (
            <ul className="divide-y">
              {questions.map((q) => (
                <li key={q.id} className="grid gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="min-w-0 flex-1 font-medium hover:underline" href={`/${locale}/tasks/${q.id}`}>
                      {q.question}
                    </Link>
                    <TaskStatusBadge status={q.status} label={t(`agentTasks.status.${q.status}`)} />
                    <span className="text-xs text-muted-foreground">{formatDateTime(q.createdAt, locale, tz)}</span>
                  </div>
                  {q.status === "FAILED" ? <Notice tone="danger">{t("agentTasks.failed", { message: q.errorMessage ?? q.errorCode ?? "" })}</Notice> : null}
                  {q.output ? (
                    <details className="group" open={q === questions[0]}>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t("brain.ask.answer")}</summary>
                      <div className="mt-2 grid gap-2">
                        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{q.output}</div>
                        <CitationList citations={q.citations} locale={locale} t={t} emptyText={t("agentTasks.noSources")} />
                      </div>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
