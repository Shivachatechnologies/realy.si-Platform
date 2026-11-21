import type { Metadata } from "next";
import Link from "next/link";
import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/comms/client";
import { PostCard } from "@/components/comms/feed";
import { EmptyState, hrefWith, MEETING_TONE, Pager, SectionTabs } from "@/components/comms/bits";
import { RsvpButtons } from "@/components/comms/meetings";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listAnnouncements } from "@/server/modules/comms/announcements";
import { listPeople } from "@/server/modules/comms/common";
import { listPosts } from "@/server/modules/comms/feed";
import { listMeetings } from "@/server/modules/comms/meetings";
import { hubCounts, listConversations, listMentions, type MentionKind } from "@/server/modules/comms/hub";
import { cn } from "@/lib/utils";

const HUB_VIEWS = ["feed", "conversations", "mentions", "announcements", "meetings"] as const;
type HubView = (typeof HUB_VIEWS)[number];
const MENTION_KINDS: MentionKind[] = ["message", "post", "comment", "task_comment"];

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.communication.title") };
}

export default async function CommunicationFeedPage({ searchParams }: PageProps<"/[locale]/communication">) {
  const p = await areaPage("communication", "feed");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").slice(0, 200) || undefined;
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const me = viewer.user.id;
  const view: HubView = HUB_VIEWS.find((v) => v === sp.view) ?? "feed";
  const path = `/${locale}/communication`;
  const counts = await hubCounts(viewer.ctx, org.id, company.id);
  const hubTabs = (
    <SectionTabs
      label={t("communication.hub.label")}
      active={view}
      tabs={HUB_VIEWS.map((v) => ({
        key: v,
        href: v === "feed" ? path : `${path}?view=${v}`,
        label: t(`communication.hub.${v}`),
        badge: v === "conversations" ? counts.conversations : v === "announcements" ? counts.announcements : v === "meetings" ? counts.meetings : undefined,
      }))}
    />
  );
  if (view !== "feed") return wrap(<div className="grid gap-4">{hubTabs}{await HubView({ view, p, sp })}</div>);
  const [posts, people, announcements, meetings, actionItems, unread] = await Promise.all([
    listPosts(viewer.ctx, org.id, company.id, { q, cursor }),
    listPeople(viewer.ctx, org.id, company.id),
    listAnnouncements(viewer.ctx, org.id, company.id, { status: "PUBLISHED" }),
    listMeetings(viewer.ctx, org.id, company.id, { scope: "upcoming" }),
    db().workTask.findMany({ where: { organizationId: org.id, companyId: company.id, sourceType: "meeting", assigneeId: me, status: { notIn: ["DONE", "CANCELLED"] } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }], take: 8, select: { id: true, title: true, dueDate: true, sourceId: true } }),
    db().notification.count({ where: { organizationId: org.id, userId: me, readAt: null } }),
  ]);
  const pinned = announcements.data.filter((a) => a.pinned || !a.read).slice(0, 5);
  const upcoming = meetings.data.filter((m) => m.attendees.some((a) => a.userId === me) || m.organizerId === me).slice(0, 5);
  const peopleLite = people.map((u) => ({ id: u.id, name: u.name }));

  return wrap(
    <div className="grid gap-4">
    {hubTabs}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={t("communication.feed.title")} description={t("communication.feed.description")} />
          {perms.post ? (
            <CardBody className="border-b">
              <Composer path={`${base}/comms/posts`} people={peopleLite} placeholder={t("communication.feed.placeholder")} submitLabel={t("communication.feed.post")} />
            </CardBody>
          ) : null}
          <form className="flex gap-2 border-b p-3" action={`/${locale}/communication`}>
            <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} placeholder={t("communication.feed.search")} aria-label={t("communication.feed.search")} />
            <Button type="submit" variant="secondary">
              {t("communication.search")}
            </Button>
          </form>
          {posts.data.length === 0 ? (
            <EmptyState>{q ? t("common.noResults") : t("communication.feed.empty")}</EmptyState>
          ) : (
            posts.data.map((post) => (
              <PostCard
                key={post.id}
                base={base}
                people={peopleLite}
                me={me}
                canPost={perms.post}
                canManage={perms.manage}
                post={{ id: post.id, authorId: post.authorId, authorName: post.authorName, body: post.body, when: formatDateTime(post.createdAt, locale, tz), edited: !!post.editedAt, commentCount: post.commentCount, reactions: post.reactions }}
              />
            ))
          )}
          <Pager labels={{ prev: t("communication.newest"), next: t("communication.older") }} prevHref={cursor ? hrefWith(`/${locale}/communication`, sp, { cursor: undefined }) : null} nextHref={posts.nextCursor ? hrefWith(`/${locale}/communication`, sp, { cursor: posts.nextCursor }) : null} />
        </Card>
      </div>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={t("communication.announcements.title")} actions={<Link className="text-xs hover:underline" href={`/${locale}/communication/announcements`}>{t("communication.viewAll")}</Link>} />
          {pinned.length ? (
            <ul className="grid divide-y">
              {pinned.map((a) => (
                <li key={a.id} className="grid gap-0.5 px-4 py-2 text-sm">
                  <Link href={`/${locale}/communication/announcements/${a.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
                    {a.pinned ? <Pin className="size-3.5 shrink-0" aria-label={t("communication.announcements.pinned")} /> : null}
                    <span className="truncate">{a.title}</span>
                    {!a.read ? <Badge tone="accent">{t("communication.new")}</Badge> : null}
                  </Link>
                  <span className="text-xs text-muted-foreground">{a.publishedAt ? formatDate(a.publishedAt, locale, tz) : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t("communication.announcements.none")}</EmptyState>
          )}
        </Card>
        <Card>
          <CardHeader title={t("communication.meetings.upcoming")} actions={<Link className="text-xs hover:underline" href={`/${locale}/communication/meetings`}>{t("communication.viewAll")}</Link>} />
          {upcoming.length ? (
            <ul className="grid divide-y">
              {upcoming.map((m) => (
                <li key={m.id} className="grid gap-0.5 px-4 py-2 text-sm">
                  <Link href={`/${locale}/communication/meetings/${m.id}`} className="truncate font-medium hover:underline">
                    {m.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatDateTime(m.startsAt, locale, tz)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t("communication.meetings.noUpcoming")}</EmptyState>
          )}
        </Card>
        <Card>
          <CardHeader title={t("communication.meetings.myActionItems")} />
          {actionItems.length ? (
            <ul className="grid divide-y">
              {actionItems.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <Link href={`/${locale}/communication/meetings/${a.sourceId}`} className="min-w-0 flex-1 truncate hover:underline">
                    {a.title}
                  </Link>
                  {a.dueDate ? <span className="text-xs text-muted-foreground">{formatDate(a.dueDate, locale, "UTC")}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t("communication.meetings.noActionItems")}</EmptyState>
          )}
        </Card>
        <Link href={`/${locale}/notifications`} className="rounded-lg border bg-surface px-4 py-3 text-sm hover:bg-muted">
          {t("communication.notificationsLink", { count: unread })}
        </Link>
      </div>
    </div>
    </div>,
  );
}

type Hub = Extract<Awaited<ReturnType<typeof areaPage>>, { gate: null }>;

/** Non-feed hub views: conversations, mentions, announcements, meetings. */
async function HubView({ view, p, sp }: { view: Exclude<HubView, "feed">; p: Hub; sp: Record<string, string | string[] | undefined> }) {
  const { locale, t, viewer, org, company, tz, base } = p;
  const me = viewer.user.id;
  const path = `/${locale}/communication`;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  if (view === "conversations") {
    const q = one("q")?.slice(0, 200) || undefined;
    const unreadOnly = one("unread") === "1";
    const list = await listConversations(viewer.ctx, org.id, company.id, { q, unread: unreadOnly });
    return (
      <Card>
        <CardHeader title={t("communication.hub.conversations")} description={t("communication.hub.conversationsHint", { count: list.unread })} actions={<span className="flex gap-2 text-xs"><Link className="hover:underline" href={`/${locale}/communication/channels`}>{t("communication.tabs.channels")}</Link><Link className="hover:underline" href={`/${locale}/communication/messages`}>{t("communication.tabs.messages")}</Link></span>} />
        <form className="flex flex-wrap gap-2 border-b p-3" action={path}>
          <input type="hidden" name="view" value="conversations" />
          <Input className="min-w-0 flex-1" name="q" type="search" defaultValue={q ?? ""} maxLength={200} placeholder={t("communication.hub.searchConversations")} aria-label={t("communication.hub.searchConversations")} />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="unread" value="1" defaultChecked={unreadOnly} />
            {t("communication.hub.unreadOnly")}
          </label>
          <Button type="submit" variant="secondary">
            {t("communication.search")}
          </Button>
        </form>
        {list.data.length === 0 ? (
          <EmptyState>{q || unreadOnly ? t("common.noResults") : t("communication.hub.noConversations")}</EmptyState>
        ) : (
          <ul className="grid divide-y">
            {list.data.map((c) => (
              <li key={c.id}>
                <Link href={`/${locale}/communication/${c.isDirect ? "messages" : "channels"}/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                  <span className={cn("min-w-0 flex-1 truncate text-sm", c.unread ? "font-semibold" : "")}>
                    {c.isDirect ? c.name : `#${c.name}`}
                    {c.archivedAt ? <span className="ms-1 text-xs text-muted-foreground">· {t("communication.archived")}</span> : null}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{c.isDirect ? t("communication.hub.direct") : t("communication.channels.membersCount", { count: c.memberCount })}</span>
                  <span className="text-xs text-muted-foreground">{c.lastMessageAt ? formatDateTime(c.lastMessageAt, locale, tz) : "—"}</span>
                  {c.unread ? <Badge tone="accent">{c.unread}</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  if (view === "mentions") {
    const kind = MENTION_KINDS.find((k) => k === one("kind"));
    const beforeRaw = one("before");
    const before = beforeRaw ? new Date(beforeRaw) : undefined;
    const list = await listMentions(viewer.ctx, org.id, company.id, { before: before && !Number.isNaN(before.getTime()) ? before : undefined, kind });
    return (
      <Card>
        <CardHeader title={t("communication.hub.mentions")} description={t("communication.hub.mentionsHint")} />
        <div className="flex flex-wrap gap-1 border-b px-4 py-2 text-sm">
          {[undefined, ...MENTION_KINDS].filter((k) => k !== "task_comment" || list.includesTaskComments).map((k) => (
            <Link key={k ?? "all"} href={hrefWith(path, { view: "mentions" }, { kind: k })} aria-current={kind === k ? "page" : undefined} className={cn("rounded-md px-2 py-1", kind === k ? "bg-muted font-medium" : "hover:bg-muted")}>
              {t(`communication.hub.mentionKind.${k ?? "all"}`)}
            </Link>
          ))}
        </div>
        {list.data.length === 0 ? (
          <EmptyState>{t("communication.hub.noMentions")}</EmptyState>
        ) : (
          <ul className="grid divide-y">
            {list.data.map((m) => (
              <li key={`${m.kind}-${m.id}`}>
                <Link href={`/${locale}${m.href}`} className="grid gap-0.5 px-4 py-2.5 hover:bg-muted/50">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="text-sm font-medium text-foreground">{m.authorName ?? "?"}</span>
                    <Badge>{t(`communication.hub.mentionKind.${m.kind}`)}</Badge>
                    {m.context ? <span className="truncate">{m.kind === "comment" ? t(`communication.hub.subject.${m.context}`) : m.context}</span> : null}
                    <span className="ms-auto">{formatDateTime(m.createdAt, locale, tz)}</span>
                  </span>
                  <span className="line-clamp-2 text-sm">{m.excerpt}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pager labels={{ prev: t("communication.newest"), next: t("communication.older") }} prevHref={beforeRaw ? hrefWith(path, sp, { before: undefined }) : null} nextHref={list.nextBefore ? hrefWith(path, sp, { before: list.nextBefore }) : null} />
      </Card>
    );
  }

  if (view === "announcements") {
    const list = await listAnnouncements(viewer.ctx, org.id, company.id, { status: "PUBLISHED" });
    return (
      <Card>
        <CardHeader title={t("communication.announcements.title")} actions={<Link className="text-xs hover:underline" href={`/${locale}/communication/announcements`}>{t("communication.viewAll")}</Link>} />
        {list.data.length === 0 ? (
          <EmptyState>{t("communication.announcements.none")}</EmptyState>
        ) : (
          <ul className="grid divide-y">
            {list.data.map((a) => (
              <li key={a.id}>
                <Link href={`/${locale}/communication/announcements/${a.id}`} className="grid gap-0.5 px-4 py-2.5 hover:bg-muted/50">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {a.pinned ? <Pin className="size-3.5 shrink-0" aria-label={t("communication.announcements.pinned")} /> : null}
                    <span className="truncate">{a.title}</span>
                    {!a.read ? <Badge tone="accent">{t("communication.new")}</Badge> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.authorName ?? "?"} · {a.publishedAt ? formatDate(a.publishedAt, locale, tz) : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  const meetings = await listMeetings(viewer.ctx, org.id, company.id, { scope: "upcoming" });
  const mine = meetings.data.filter((m) => m.organizerId === me || m.attendees.some((a) => a.userId === me));
  return (
    <Card>
      <CardHeader title={t("communication.meetings.upcoming")} actions={<Link className="text-xs hover:underline" href={`/${locale}/communication/meetings`}>{t("communication.viewAll")}</Link>} />
      {mine.length === 0 ? (
        <EmptyState>{t("communication.meetings.noUpcoming")}</EmptyState>
      ) : (
        <ul className="grid divide-y">
          {mine.map((m) => (
            <li key={m.id} className="grid gap-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="grid min-w-0 gap-0.5">
                <Link href={`/${locale}/communication/meetings/${m.id}`} className="flex items-center gap-2 truncate text-sm font-medium hover:underline">
                  {m.title}
                  <Badge tone={MEETING_TONE[m.status]}>{t(`communication.meetings.statuses.${m.status}`)}</Badge>
                  {m.recurrence ? <span className="text-xs font-normal text-muted-foreground">{t(`communication.meetings.recurrence.${m.recurrence}`)}</span> : null}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(m.startsAt, locale, tz)}
                  {m.location ? ` · ${m.location}` : ""} · {m.organizerName ?? "?"}
                </span>
              </div>
              {m.organizerId !== me && m.myRsvp ? <RsvpButtons base={base} meetingId={m.id} current={m.myRsvp === "PENDING" ? null : m.myRsvp} inSeries={false} /> : <Badge>{t("communication.meetings.organizer")}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
