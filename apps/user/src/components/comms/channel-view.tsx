import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { Translate } from "@/i18n/translate";
import { formatDateTime } from "@/i18n/format";
import type { RequestContext } from "@/server/core/context";
import { isAppError } from "@/server/core/errors";
import { getChannel, listMessages } from "@/server/modules/comms/channels";
import { listPeople } from "@/server/modules/comms/common";
import { ActionButton, Composer } from "./client";
import { AddMembers, ChannelSettings, MessageItem } from "./channels";
import { hrefWith } from "./bits";

/** Conversation page body shared by team channels and direct messages. */
export async function ChannelView({ ctx, t, locale, tz, base, organizationId, companyId, channelId, me, canManage, kind, sp }: {
  ctx: RequestContext;
  t: Translate;
  locale: string;
  tz: string;
  base: string;
  organizationId: string;
  companyId: string;
  channelId: string;
  me: string;
  canManage: boolean;
  kind: "channels" | "messages";
  sp: Record<string, string | string[] | undefined>;
}) {
  const channel = await getChannel(ctx, organizationId, companyId, channelId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  if ((kind === "messages") !== channel.isDirect) notFound();
  const thread = typeof sp.thread === "string" ? sp.thread : undefined;
  const before = typeof sp.before === "string" ? sp.before : undefined;
  const [messages, replies, people] = await Promise.all([
    listMessages(ctx, organizationId, companyId, channelId, { before }),
    thread ? listMessages(ctx, organizationId, companyId, channelId, { parentId: thread }) : null,
    listPeople(ctx, organizationId, companyId),
  ]);
  const peopleLite = people.map((u) => ({ id: u.id, name: u.name }));
  const path = `/${locale}/communication/${kind}/${channelId}`;
  const parent = replies?.parent;
  const view = (m: (typeof messages.data)[number]) => ({ id: m.id, authorId: m.authorId, authorName: m.authorName, body: m.body, when: formatDateTime(m.createdAt, locale, tz), edited: !!m.editedAt, deleted: !!m.deletedAt, replyCount: m.replyCount, tasks: m.tasks });
  const archived = !!channel.archivedAt;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                {channel.isDirect ? null : channel.visibility === "PRIVATE" ? <Lock className="size-4" aria-hidden /> : <Hash className="size-4" aria-hidden />}
                {channel.displayName}
              </span>
            }
            description={channel.description ?? undefined}
            actions={archived ? <Badge tone="warning">{t("communication.archived")}</Badge> : null}
          />
          {messages.olderCursor ? (
            <div className="border-b px-4 py-2 text-center text-xs">
              <Link className="hover:underline" href={hrefWith(path, sp, { before: messages.olderCursor, thread: undefined })}>
                {t("communication.messages.loadOlder")}
              </Link>
            </div>
          ) : before ? (
            <div className="border-b px-4 py-2 text-center text-xs">
              <Link className="hover:underline" href={path}>
                {t("communication.messages.latest")}
              </Link>
            </div>
          ) : null}
          {messages.data.length ? (
            <ul className="grid py-2">
              {messages.data.map((m) => (
                <MessageItem key={m.id} locale={locale} base={base} m={view(m)} people={peopleLite} me={me} canManage={canManage} threadHref={hrefWith(path, sp, { thread: m.id })} />
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("communication.messages.empty")}</p>
          )}
          <CardBody className="border-t">
            {archived ? (
              <Notice>{t("communication.channels.archivedNotice")}</Notice>
            ) : channel.canPost ? (
              <Composer path={`${base}/comms/channels/${channelId}/messages`} people={peopleLite} rows={2} placeholder={t("communication.messages.placeholder", { name: channel.displayName })} submitLabel={t("communication.messages.send")} />
            ) : (
              <Notice>{t("communication.readOnly")}</Notice>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="grid content-start gap-4">
        {thread && replies ? (
          <Card>
            <CardHeader title={t("communication.messages.thread")} actions={<Link href={hrefWith(path, sp, { thread: undefined })} className="text-xs hover:underline">{t("common.close")}</Link>} />
            {parent ? (
              <ul className="border-b">
                <MessageItem locale={locale} base={base} m={view(parent)} people={peopleLite} me={me} canManage={canManage} />
              </ul>
            ) : null}
            <ul className="grid py-1">
              {replies.data.map((m) => (
                <MessageItem key={m.id} locale={locale} base={base} m={view(m)} people={peopleLite} me={me} canManage={canManage} />
              ))}
            </ul>
            {!archived && channel.canPost ? (
              <CardBody className="border-t">
                <Composer path={`${base}/comms/channels/${channelId}/messages`} extraBody={{ parentId: thread }} people={peopleLite} rows={2} placeholder={t("communication.messages.replyPlaceholder")} submitLabel={t("communication.messages.reply")} />
              </CardBody>
            ) : null}
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("communication.channels.membersCount", { count: channel.members.length })} />
          <ul className="grid max-h-72 divide-y overflow-y-auto">
            {channel.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-2 px-4 py-1.5 text-sm">
                <span className="truncate">{m.name ?? "?"}</span>
                {!channel.isDirect && (channel.canAdminister || m.userId === me) ? (
                  <ActionButton path={`${base}/comms/channels/${channelId}/members?userId=${m.userId}`} method="DELETE" variant="ghost" confirm={m.userId === me ? t("communication.channels.confirmLeave") : t("communication.channels.confirmRemove")} redirectTo={m.userId === me ? `/${locale}/communication/channels` : undefined}>
                    {m.userId === me ? t("communication.channels.leave") : t("communication.channels.remove")}
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
          {!channel.isDirect && !channel.member && channel.visibility === "PUBLIC" ? (
            <CardBody className="border-t">
              <ActionButton path={`${base}/comms/channels/${channelId}/members`} body={{ userIds: [me] }} variant="default">
                {t("communication.channels.join")}
              </ActionButton>
            </CardBody>
          ) : null}
          {channel.canAdminister && !channel.isDirect ? (
            <CardBody className="border-t">
              <AddMembers base={base} channelId={channelId} people={peopleLite} existing={channel.members.map((m) => m.userId)} />
            </CardBody>
          ) : null}
        </Card>
        {channel.canAdminister && !channel.isDirect ? (
          <Card>
            <CardHeader title={t("communication.channels.settings")} />
            <CardBody>
              <ChannelSettings base={base} locale={locale} canDelete={canManage} channel={{ id: channel.id, name: channel.name, description: channel.description, visibility: channel.visibility, archived }} />
            </CardBody>
          </Card>
        ) : null}
        <Link href={`/${locale}/communication/${kind}`} className="text-sm hover:underline">
          ← {kind === "channels" ? t("communication.channels.back") : t("communication.messages.back")}
        </Link>
      </div>
    </div>
  );
}
