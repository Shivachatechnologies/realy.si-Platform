import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AgendaTemplates, MeetingForm } from "@/components/comms/meetings";
import { EmptyState, hrefWith, MEETING_TONE, Pager } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { listPeople } from "@/server/modules/comms/common";
import { listAgendaTemplates, listMeetings, MEETING_STATUSES, parseMeetingFilters } from "@/server/modules/comms/meetings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.meetings.title") };
}

export default async function MeetingsPage({ searchParams }: PageProps<"/[locale]/communication/meetings">) {
  const p = await areaPage("communication", "meetings");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const sp = await searchParams;
  const filters = parseMeetingFilters(sp);
  const [list, people, templates] = await Promise.all([listMeetings(viewer.ctx, org.id, company.id, filters), listPeople(viewer.ctx, org.id, company.id), listAgendaTemplates(viewer.ctx, org.id, company.id)]);
  const path = `/${locale}/communication/meetings`;
  return wrap(
    <div className="grid gap-4">
      {perms.post ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-4 text-sm font-medium">{t("communication.meetings.new")}</summary>
            <MeetingForm base={base} locale={locale} me={viewer.user.id} people={people.map((u) => ({ id: u.id, name: u.name }))} templates={templates.map((x) => ({ id: x.id, name: x.name, body: x.body }))} />
          </details>
        </Card>
      ) : null}
      {perms.post ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-4 text-sm font-medium">{t("communication.meetings.templates", { count: templates.length })}</summary>
            <div className="p-4 pt-0">
              <AgendaTemplates base={base} me={viewer.user.id} canManage={perms.manage} templates={templates.map((x) => ({ id: x.id, name: x.name, body: x.body, createdById: x.createdById }))} />
            </div>
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("communication.meetings.title")} description={t("communication.meetings.description")} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} placeholder={t("communication.meetings.search")} aria-label={t("communication.meetings.search")} />
          <Select name="scope" defaultValue={filters.scope ?? ""} aria-label={t("communication.meetings.scope")}>
            <option value="">{t("communication.meetings.scopes.all")}</option>
            {(["upcoming", "mine", "past"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`communication.meetings.scopes.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("communication.meetings.allStatuses")}</option>
            {MEETING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`communication.meetings.statuses.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("communication.search")}
          </Button>
        </form>
        {list.data.length === 0 ? (
          <EmptyState>{filters.q || filters.scope || filters.status ? t("common.noResults") : t("communication.meetings.empty")}</EmptyState>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("communication.meetings.titleLabel")}</Th>
                <Th>{t("communication.meetings.when")}</Th>
                <Th className="hidden md:table-cell">{t("communication.meetings.organizer")}</Th>
                <Th className="hidden md:table-cell">{t("communication.meetings.attendees")}</Th>
                <Th>{t("common.status")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <Link href={`${path}/${m.id}`} className="font-medium hover:underline">
                      {m.title}
                    </Link>
                    {m.recurrence ? <span className="ms-1.5 text-xs text-muted-foreground">· {t(`communication.meetings.recurrence.${m.recurrence}`)}</span> : null}
                    {m.myRsvp && m.myRsvp !== "ACCEPTED" && m.organizerId !== viewer.user.id ? (
                      <Badge className="ms-1.5" tone={m.myRsvp === "PENDING" ? "accent" : m.myRsvp === "DECLINED" ? "danger" : "warning"}>
                        {t(`communication.meetings.rsvp.${m.myRsvp}`)}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(m.startsAt, locale, tz)}</Td>
                  <Td className="hidden md:table-cell">{m.organizerName ?? "?"}</Td>
                  <Td className="hidden max-w-64 truncate md:table-cell">{m.attendeeNames.join(", ")}</Td>
                  <Td>
                    <Badge tone={MEETING_TONE[m.status]}>{t(`communication.meetings.statuses.${m.status}`)}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager labels={{ prev: t("communication.first"), next: t("communication.more") }} prevHref={filters.cursor ? hrefWith(path, sp, { cursor: undefined }) : null} nextHref={list.nextCursor ? hrefWith(path, sp, { cursor: list.nextCursor }) : null} />
      </Card>
    </div>,
  );
}
