import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { voicePage } from "@/components/voice/context";
import { AgentForm, VoiceAction } from "@/components/voice/client";
import { CallsTable } from "@/components/voice/calls-table";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { employeeOptions, getAgent } from "@/server/modules/voice/agents";
import { listCalls } from "@/server/modules/voice/calls";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.tabs.agents") };
}

export default async function VoiceAgentPage({ params }: PageProps<"/[locale]/voice/agents/[agentId]">) {
  const { agentId } = await params;
  const p = await voicePage("agents");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  const a = await getAgent(viewer.ctx, org.id, company.id, agentId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const [employees, calls] = await Promise.all([employeeOptions(viewer.ctx, org.id, company.id), listCalls(viewer.ctx, org.id, company.id, { view: "all", agentId: a.id })]);
  const providerKey = a.provider === "VAPI" ? "vapi" : "retell";
  return wrap(
    <div className="grid gap-4">
      <Link href={`/${locale}/voice/agents`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" /> {t("voice.agents.back")}
      </Link>
      {a.archivedAt ? <Notice tone="warning">{t("voice.agents.archived")}</Notice> : null}
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {a.name}
              <Badge tone={a.syncStatus === "SYNCED" ? "success" : a.syncStatus === "ERROR" ? "danger" : "warning"}>{t(`voice.sync.${a.syncStatus}`)}</Badge>
            </span>
          }
          description={t("voice.agents.onProvider", { provider: t(`voice.providers.${providerKey}.name`) })}
          actions={
            perms.manage && !a.archivedAt ? (
              <div className="flex flex-wrap gap-2">
                <VoiceAction path={`${base}/voice/agents/${a.id}/sync`} label={t("voice.agents.sync")} icon="sync" done={t("voice.agents.synced")} />
                <VoiceAction path={`${base}/voice/agents/${a.id}/knowledge`} label={t("voice.agents.refreshKnowledge")} done={t("voice.agents.knowledgeRefreshed")} />
                <VoiceAction path={`${base}/voice/agents/${a.id}`} method="DELETE" label={t("voice.agents.archive")} confirm={t("voice.agents.archiveConfirm")} variant="ghost" />
              </div>
            ) : undefined
          }
        />
        <CardBody className="grid gap-3">
          {a.syncError ? (
            <Notice tone="warning" action={perms.integrations ? <Link href={`/${locale}/integrations/${providerKey}`} className="text-sm font-medium text-primary hover:underline">{t("voice.setup.connect")}</Link> : undefined}>
              {a.syncError}
            </Notice>
          ) : null}
          <div className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">{t("voice.agents.opening")}</span>
            <p className="rounded-md border bg-muted/40 px-3 py-2 italic">“{a.opening}”</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {a.knowledgeBuiltAt ? t("voice.agents.knowledgeBuilt", { when: formatDateTime(a.knowledgeBuiltAt, locale, tz) }) : t("voice.agents.noKnowledge")}
            {a.syncedAt ? ` · ${t("voice.agents.lastSynced", { when: formatDateTime(a.syncedAt, locale, tz) })}` : ""}
          </p>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("voice.agents.promptPreview")}</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{a.prompt}</pre>
          </details>
        </CardBody>
      </Card>
      {perms.manage && !a.archivedAt ? (
        <Card>
          <CardHeader title={t("voice.agents.edit")} />
          <CardBody>
            <AgentForm
              base={base}
              locale={locale}
              employees={employees}
              value={{ id: a.id, name: a.name, aiEmployeeId: a.aiEmployeeId, goal: a.goal, language: a.language as "en-US", voiceId: a.voiceId ?? "", greeting: a.greeting ?? "", instructions: a.instructions ?? "", offerNotes: a.offerNotes ?? "" }}
            />
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("voice.agents.calls")} />
        <CardBody className="p-0">{calls.rows.length ? <CallsTable rows={calls.rows} t={t} locale={locale} tz={tz} /> : <p className="p-4 text-sm text-muted-foreground">{t("voice.calls.empty")}</p>}</CardBody>
      </Card>
    </div>,
  );
}
