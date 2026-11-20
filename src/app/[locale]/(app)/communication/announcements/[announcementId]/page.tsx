import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/comms/client";
import { AnnouncementForm } from "@/components/comms/announcement-form";
import { CommentThread } from "@/components/comms/feed";
import { areaPage } from "@/components/comms/context";
import { Markdownish } from "@/components/comms/markdownish";
import { MarkRead, ShareToChat } from "@/components/comms/misc";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { audienceOptions, getAnnouncement } from "@/server/modules/comms/announcements";
import { listPeople } from "@/server/modules/comms/common";
import { connectionStatuses } from "@/server/modules/comms/connections-bridge";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.announcements.title") };
}

export default async function AnnouncementPage({ params }: PageProps<"/[locale]/communication/announcements/[announcementId]">) {
  const { announcementId } = await params;
  const p = await areaPage("communication", "announcements");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const a = await getAnnouncement(viewer.ctx, org.id, company.id, announcementId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const [people, groups, conns] = await Promise.all([listPeople(viewer.ctx, org.id, company.id), a.manager ? audienceOptions(viewer.ctx, org.id, company.id) : null, connectionStatuses(org.id, company.id)]);
  const path = `${base}/comms/announcements/${a.id}`;
  return wrap(
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {a.status === "PUBLISHED" && !a.read ? <MarkRead path={`${path}/read`} /> : null}
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader
            title={a.title}
            description={`${a.authorName ?? "?"} · ${a.publishedAt ? formatDateTime(a.publishedAt, locale, tz) : t(`communication.announcements.statuses.${a.status}`)}`}
            actions={
              <div className="flex flex-wrap gap-1">
                {a.pinned ? <Badge tone="accent">{t("communication.announcements.pinned")}</Badge> : null}
                <Badge>{a.audienceName ?? t(`communication.announcements.audiences.${a.audience}`)}</Badge>
              </div>
            }
          />
          <CardBody>
            <Markdownish text={a.body} />
          </CardBody>
        </Card>
        {a.status === "PUBLISHED" ? (
          <Card>
            <CardHeader title={t("communication.comments")} />
            <CardBody>
              <CommentThread base={base} subjectType="announcement" subjectId={a.id} people={people.map((u) => ({ id: u.id, name: u.name }))} me={viewer.user.id} canPost={perms.post} canManage={perms.manage} />
            </CardBody>
          </Card>
        ) : null}
        {a.manager && groups ? (
          <Card>
            <details>
              <summary className="cursor-pointer p-4 text-sm font-medium">{t("communication.edit")}</summary>
              <AnnouncementForm base={base} locale={locale} departments={groups.departments} teams={groups.teams} initial={{ id: a.id, title: a.title, body: a.body, audience: a.audience, audienceId: a.audienceId, pinned: a.pinned, status: a.status, publishAt: a.publishAt?.toISOString() ?? null }} />
            </details>
          </Card>
        ) : null}
      </div>
      <div className="grid content-start gap-4">
        {a.manager ? (
          <Card>
            <CardHeader title={t("communication.announcements.manage")} />
            <CardBody className="flex flex-wrap gap-2">
              {a.status !== "PUBLISHED" && a.status !== "ARCHIVED" ? (
                <ActionButton path={path} method="PATCH" body={{ mode: "now" }} variant="default">
                  {t("communication.announcements.publishNow")}
                </ActionButton>
              ) : null}
              <ActionButton path={path} method="PATCH" body={{ pinned: !a.pinned }}>
                {a.pinned ? t("communication.announcements.unpin") : t("communication.announcements.pin")}
              </ActionButton>
              {a.status !== "ARCHIVED" ? (
                <ActionButton path={path} method="PATCH" body={{ status: "ARCHIVED" }}>
                  {t("communication.archive")}
                </ActionButton>
              ) : null}
              <ActionButton path={path} method="DELETE" variant="danger" confirm={t("communication.confirmDelete")} redirectTo={`/${locale}/communication/announcements`}>
                {t("communication.delete")}
              </ActionButton>
            </CardBody>
          </Card>
        ) : null}
        {a.status === "PUBLISHED" && perms.post ? (
          <Card>
            <CardHeader title={t("communication.share.title")} description={t("communication.share.description")} />
            <CardBody>
              <ShareToChat base={base} subjectType="announcement" subjectId={a.id} connected={{ slack: conns.slack === "CONNECTED", microsoft_teams: conns.microsoft_teams === "CONNECTED" }} />
            </CardBody>
          </Card>
        ) : null}
        {a.manager && a.status === "PUBLISHED" ? (
          <Card>
            <CardHeader title={t("communication.announcements.receipts")} description={t("communication.announcements.receiptsSummary", { read: a.reads.length, total: a.audienceSize })} />
            {a.reads.length ? (
              <ul className="grid max-h-80 divide-y overflow-y-auto">
                {a.reads.map((r) => (
                  <li key={r.userId} className="flex justify-between gap-2 px-4 py-1.5 text-sm">
                    <span className="truncate">{r.name ?? "?"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(r.readAt, locale, tz)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("communication.announcements.noReads")}</p>
            )}
          </Card>
        ) : null}
        <Link href={`/${locale}/communication/announcements`} className="text-sm hover:underline">
          ← {t("communication.announcements.back")}
        </Link>
      </div>
    </div>,
  );
}
