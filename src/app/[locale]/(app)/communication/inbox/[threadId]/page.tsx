import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton, AiButtons } from "@/components/comms/client";
import { ReplyForm, ThreadContactLink } from "@/components/comms/inbox";
import { AiTasksCard } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { getThread, listTemplates } from "@/server/modules/comms/email";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.inbox.title") };
}

const STATUS_TONE = { RECEIVED: "neutral", SENT: "success", FAILED: "danger", NOT_CONFIGURED: "warning" } as const;

export default async function ThreadPage({ params }: PageProps<"/[locale]/communication/inbox/[threadId]">) {
  const { threadId } = await params;
  const p = await areaPage("communication", "inbox");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const th = await getThread(viewer.ctx, org.id, company.id, threadId, { markRead: true }).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const [templates, tasks] = await Promise.all([listTemplates(viewer.ctx, org.id, company.id), perms.runAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, "email_thread", th.id) : Promise.resolve([])]);
  const via = th.account && th.connection ? t("communication.inbox.viaMailbox", { address: th.account.address }) : t("communication.inbox.viaPlatform");
  return wrap(
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={th.subject} description={th.participants.join(", ")} actions={<ActionButton path={`${base}/comms/email/threads/${th.id}`} method="PATCH" body={{ unread: true }} variant="ghost">{t("communication.inbox.markUnread")}</ActionButton>} />
          <ul className="grid divide-y">
            {th.messages.map((m) => {
              const files = (Array.isArray(m.attachments) ? m.attachments : []) as { name: string; contentType: string; size: number }[];
              return (
                <li key={m.id} className="grid gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="text-sm font-medium text-foreground">{m.direction === "INBOUND" ? m.fromAddress : m.fromAddress === "platform" ? t("communication.inbox.platformMailer") : m.fromAddress}</span>
                    <span>→ {m.toAddresses.join(", ")}</span>
                    <span className="ms-auto">{formatDateTime(m.sentAt, locale, tz)}</span>
                    <Badge tone={STATUS_TONE[m.status]}>{t(`communication.inbox.messageStatus.${m.status}`)}</Badge>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{m.bodyText}</p>
                  {files.length ? (
                    <ul className="flex flex-wrap gap-2">
                      {files.map((f, i) => (
                        <li key={i} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                          <Paperclip className="size-3" aria-hidden />
                          {f.name} · {Math.max(1, Math.round(f.size / 1024))} KB
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.error && m.status !== "SENT" ? <p className="font-mono text-[11px] text-muted-foreground">{m.error}</p> : null}
                </li>
              );
            })}
          </ul>
          {th.canPost ? (
            <CardBody className="border-t">
              {th.account && !th.connection ? <Notice tone="warning" className="mb-2">{t("communication.inbox.threadMailboxDisconnected")}</Notice> : null}
              <ReplyForm base={base} threadId={th.id} templates={templates} viaLabel={via} />
            </CardBody>
          ) : null}
        </Card>
      </div>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={t("communication.inbox.contact")} description={th.contact ? `${th.contact.firstName} ${th.contact.lastName ?? ""} ${th.contact.email ? `<${th.contact.email}>` : ""}` : t("communication.inbox.noContact")} />
          {th.canPost ? (
            <CardBody>
              <ThreadContactLink base={base} threadId={th.id} current={th.contactId} />
            </CardBody>
          ) : null}
        </Card>
        {perms.runAgents ? (
          <AiTasksCard
            t={t}
            locale={locale}
            tz={tz}
            title={t("communication.inbox.ai.title")}
            description={t("communication.inbox.ai.description")}
            tasks={tasks}
            notConfigured={!perms.aiReady}
            actions={<AiButtons path={`${base}/comms/email/threads/${th.id}/ai`} modes={[{ mode: "draft", label: t("communication.inbox.ai.draft") }, { mode: "summarize", label: t("communication.inbox.ai.summarize") }]} />}
          />
        ) : null}
        <Link href={`/${locale}/communication/inbox`} className="text-sm hover:underline">
          ← {t("communication.inbox.back")}
        </Link>
      </div>
    </div>,
  );
}
