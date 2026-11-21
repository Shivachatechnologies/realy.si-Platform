import type { Metadata } from "next";
import Link from "next/link";
import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { AnnouncementForm } from "@/components/comms/announcement-form";
import { EmptyState, hrefWith, Pager } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { Markdownish } from "@/components/comms/markdownish";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { ANNOUNCEMENT_STATUSES, audienceOptions, listAnnouncements, parseAnnouncementFilters } from "@/server/modules/comms/announcements";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.announcements.title") };
}

const STATUS_TONE = { DRAFT: "neutral", SCHEDULED: "warning", PUBLISHED: "success", ARCHIVED: "neutral" } as const;

export default async function AnnouncementsPage({ searchParams }: PageProps<"/[locale]/communication/announcements">) {
  const p = await areaPage("communication", "announcements");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const sp = await searchParams;
  const filters = parseAnnouncementFilters(sp);
  const [list, groups] = await Promise.all([listAnnouncements(viewer.ctx, org.id, company.id, filters), audienceOptions(viewer.ctx, org.id, company.id)]);
  const path = `/${locale}/communication/announcements`;
  return wrap(
    <div className="grid gap-4">
      {perms.manage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-4 text-sm font-medium">{t("communication.announcements.new")}</summary>
            <AnnouncementForm base={base} locale={locale} departments={groups.departments} teams={groups.teams} />
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("communication.announcements.title")} description={t("communication.announcements.description")} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} placeholder={t("communication.announcements.search")} aria-label={t("communication.announcements.search")} />
          {list.manager ? (
            <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
              <option value="">{t("communication.announcements.activeStatuses")}</option>
              {ANNOUNCEMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`communication.announcements.statuses.${s}`)}
                </option>
              ))}
            </Select>
          ) : (
            <span className="hidden sm:block" />
          )}
          <Button type="submit" variant="secondary">
            {t("communication.search")}
          </Button>
        </form>
        {list.data.length === 0 ? (
          <EmptyState>{filters.q || filters.status ? t("common.noResults") : t("communication.announcements.empty")}</EmptyState>
        ) : (
          <ul className="grid divide-y">
            {list.data.map((a) => (
              <li key={a.id} className="grid gap-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {a.pinned ? <Pin className="size-3.5" aria-label={t("communication.announcements.pinned")} /> : null}
                  <Link href={`${path}/${a.id}`} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                  {list.manager || a.status !== "PUBLISHED" ? <Badge tone={STATUS_TONE[a.status]}>{t(`communication.announcements.statuses.${a.status}`)}</Badge> : null}
                  {a.status === "PUBLISHED" && !a.read ? <Badge tone="accent">{t("communication.new")}</Badge> : null}
                  <Badge>{t(`communication.announcements.audiences.${a.audience}`)}</Badge>
                </div>
                <div className="line-clamp-2 text-muted-foreground">
                  <Markdownish text={a.body.slice(0, 400)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {a.authorName ?? "?"} ·{" "}
                  {a.status === "SCHEDULED" && a.publishAt
                    ? t("communication.announcements.scheduledFor", { date: formatDateTime(a.publishAt, locale, tz) })
                    : a.publishedAt
                      ? formatDateTime(a.publishedAt, locale, tz)
                      : formatDateTime(a.createdAt, locale, tz)}
                  {list.manager && a.status === "PUBLISHED" ? ` · ${t("communication.announcements.readCount", { count: a.readCount })}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Pager labels={{ prev: t("communication.newest"), next: t("communication.older") }} prevHref={filters.cursor ? hrefWith(path, sp, { cursor: undefined }) : null} nextHref={list.nextCursor ? hrefWith(path, sp, { cursor: list.nextCursor }) : null} />
      </Card>
    </div>,
  );
}
