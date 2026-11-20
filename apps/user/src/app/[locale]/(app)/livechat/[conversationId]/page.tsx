import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton } from "@/components/comms/client";
import { ConversationView, type ChatMessage } from "@/components/livechat/conversation-view";
import { OutcomeBadges } from "@/components/livechat/bits";
import { livechatPage } from "@/components/livechat/context";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { db } from "@/server/core/db";
import { ensureSettings } from "@/server/modules/livechat/common";
import { getConversation } from "@/server/modules/livechat/inbox";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("livechat.view.title") };
}

export default async function LivechatConversationPage({ params }: PageProps<"/[locale]/livechat/[conversationId]">) {
  const { conversationId } = await params;
  const p = await livechatPage(null);
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  let data: Awaited<ReturnType<typeof getConversation>>;
  try {
    data = await getConversation(viewer.ctx, org.id, company.id, conversationId);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  }
  const settings = await ensureSettings(db(), org.id, company.id);
  const { conversation: c, visitor: v } = data;
  const messages: ChatMessage[] = data.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }));
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{value}</dd>
    </div>
  );
  return wrap(
    <>
      <Link href={`/${locale}/livechat`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("livechat.view.back")}
      </Link>
      {c.status === "WAITING_HUMAN" ? (
        <Notice tone="warning" title={t("livechat.view.waitingTitle")}>
          {c.handoffReason ?? t("livechat.view.waitingBody")}
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ConversationView
          base={base}
          conversationId={c.id}
          canManage={perms.manage}
          aiEnabled={settings.aiEnabled}
          names={data.names}
          viewerId={viewer.user.id}
          initial={{
            status: c.status,
            assigneeId: c.assigneeId,
            outcomes: c.outcomes,
            aiThinking: data.live.aiThinking,
            visitorOnline: data.live.visitorOnline,
            messages,
          }}
        />
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("livechat.visitor.title")} />
            <CardBody>
              <dl className="grid gap-3">
                {row(t("livechat.visitor.name"), v.name ?? t("livechat.anonymous"))}
                {row(t("livechat.visitor.email"), v.email && v.consentAt ? <a className="underline" href={`mailto:${v.email}`}>{v.email}</a> : t("livechat.visitor.notShared"))}
                {v.consentAt ? (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                    <span>{t("livechat.visitor.consentAt", { date: formatDateTime(v.consentAt, locale, tz) })}</span>
                  </div>
                ) : null}
                {row(t("livechat.visitor.language"), v.locale)}
                {c.pageUrl ? row(t("livechat.visitor.page"), <span className="text-xs">{c.pageUrl}</span>) : null}
                {row(t("livechat.visitor.firstSeen"), formatDateTime(v.firstSeenAt, locale, tz))}
                {data.otherConversations ? row(t("livechat.visitor.previous"), t("livechat.visitor.previousCount", { count: data.otherConversations })) : null}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("livechat.links.title")} />
            <CardBody className="grid gap-2 text-sm">
              <OutcomeBadges outcomes={c.outcomes} t={t} />
              {data.lead ? <Link className="underline" href={`/${locale}/crm/${data.lead.id}`}>{t("livechat.links.lead", { name: data.lead.name })}</Link> : null}
              {data.ticket ? <Link className="underline" href={`/${locale}/support/tickets/${data.ticket.id}`}>{t("livechat.links.ticket", { number: data.ticket.number })}</Link> : null}
              {data.meetingApproval ? (
                <Link className="underline" href={`/${locale}/approvals`}>{t("livechat.links.meeting", { status: t(`livechat.approval.${data.meetingApproval.status}`) })}</Link>
              ) : null}
              {!data.lead && !data.ticket && !data.meetingApproval ? <p className="text-muted-foreground">{t("livechat.links.none")}</p> : null}
            </CardBody>
          </Card>
          {perms.manage ? (
            <Card>
              <CardHeader title={t("livechat.gdpr.title")} description={t("livechat.gdpr.hint", { days: settings.retentionDays })} />
              <CardBody>
                <ActionButton path={`${base}/livechat/visitors/${v.id}`} method="DELETE" variant="danger" confirm={t("livechat.gdpr.confirm")} redirectTo={`/${locale}/livechat`}>
                  {t("livechat.gdpr.delete")}
                </ActionButton>
                {data.lead || data.ticket ? <p className="mt-2 text-xs text-muted-foreground">{t("livechat.gdpr.linked")}</p> : null}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>,
  );
}
