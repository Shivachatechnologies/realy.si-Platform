import type { Metadata } from "next";
import Link from "next/link";
import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/comms/client";
import { PostCard } from "@/components/comms/feed";
import { EmptyState, hrefWith, Pager } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listAnnouncements } from "@/server/modules/comms/announcements";
import { listPeople } from "@/server/modules/comms/common";
import { listPosts } from "@/server/modules/comms/feed";
import { listMeetings } from "@/server/modules/comms/meetings";

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
    </div>,
  );
}
