import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton, AiButtons } from "@/components/comms/client";
import { ActionItemToggle, ActionItemsFromSummary, AddActionItems, DecisionsEditor, MeetingForm, NotesEditor } from "@/components/comms/meetings";
import { CommentThread } from "@/components/comms/feed";
import { AiTasksCard, MEETING_TONE } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { Markdownish } from "@/components/comms/markdownish";
import { ShareToChat } from "@/components/comms/misc";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { listPeople } from "@/server/modules/comms/common";
import { connectionStatuses } from "@/server/modules/comms/connections-bridge";
import { getMeeting } from "@/server/modules/comms/meetings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.meetings.title") };
}

export default async function MeetingPage({ params }: PageProps<"/[locale]/communication/meetings/[meetingId]">) {
  const { meetingId } = await params;
  const p = await areaPage("communication", "meetings");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const m = await getMeeting(viewer.ctx, org.id, company.id, meetingId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const [people, tasks, conns] = await Promise.all([
    listPeople(viewer.ctx, org.id, company.id),
    perms.runAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, "meeting", m.id) : Promise.resolve([]),
    connectionStatuses(org.id, company.id),
  ]);
  const attendees = m.attendees.map((a) => ({ id: a.userId, name: a.name ?? "?" }));
  const peopleLite = people.map((u) => ({ id: u.id, name: u.name }));
  const editable = m.canEdit && perms.post;
  const path = `${base}/comms/meetings/${m.id}`;
  return wrap(
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader
            title={m.title}
            description={`${formatDateTime(m.startsAt, locale, tz)} – ${formatDateTime(m.endsAt, locale, tz)}${m.location ? ` · ${m.location}` : ""}`}
            actions={<Badge tone={MEETING_TONE[m.status]}>{t(`communication.meetings.statuses.${m.status}`)}</Badge>}
          />
          <CardBody className="grid gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("communication.meetings.agenda")}</p>
              {m.agenda ? <Markdownish text={m.agenda} /> : <p className="text-sm text-muted-foreground">{t("communication.meetings.noAgenda")}</p>}
            </div>
            {m.externalProvider ? <p className="text-xs text-muted-foreground">{t("communication.meetings.syncedWith", { provider: t(`communication.providers.${m.externalProvider}`) })}</p> : null}
            {editable ? (
              <div className="flex flex-wrap gap-2">
                {m.status === "SCHEDULED" ? (
                  <ActionButton path={`${path}/complete`} variant="default">
                    {t("communication.meetings.markCompleted")}
                  </ActionButton>
                ) : null}
                {m.status === "SCHEDULED" ? (
                  <ActionButton path={path} method="PATCH" body={{ status: "CANCELLED" }} confirm={t("communication.meetings.confirmCancel")}>
                    {t("communication.meetings.cancelMeeting")}
                  </ActionButton>
                ) : null}
                {m.status === "CANCELLED" ? (
                  <ActionButton path={path} method="PATCH" body={{ status: "SCHEDULED" }}>
                    {t("communication.meetings.reschedule")}
                  </ActionButton>
                ) : null}
                {m.organizerId === viewer.user.id || perms.manage ? (
                  <ActionButton path={path} method="DELETE" variant="danger" confirm={t("communication.confirmDelete")} redirectTo={`/${locale}/communication/meetings`}>
                    {t("communication.delete")}
                  </ActionButton>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("communication.meetings.notes")} />
          <CardBody>
            <NotesEditor base={base} meetingId={m.id} initial={m.notes ?? ""} disabled={!editable} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("communication.meetings.decisions")} />
          <CardBody>
            <DecisionsEditor base={base} meetingId={m.id} decisions={m.decisions} disabled={!editable} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("communication.meetings.actionItems")} description={t("communication.meetings.actionItemsHint")} />
          <CardBody className="grid gap-3">
            {m.actionItems.length ? (
              <ul className="grid gap-1.5">
                {m.actionItems.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <ActionItemToggle base={base} meetingId={m.id} taskId={a.id} done={a.status === "DONE"} disabled={!editable && a.assigneeId !== viewer.user.id} />
                    <span className={a.status === "DONE" ? "text-muted-foreground line-through" : ""}>{a.title}</span>
                    {a.assigneeName ? <Badge>{a.assigneeName}</Badge> : null}
                    {a.dueDate ? <span className="text-xs text-muted-foreground">{formatDate(a.dueDate, locale, "UTC")}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("communication.meetings.noActionItems")}</p>
            )}
            {editable ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">{t("communication.meetings.addItems")}</summary>
                <div className="pt-2">
                  <AddActionItems base={base} meetingId={m.id} attendees={attendees} />
                </div>
              </details>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("communication.comments")} />
          <CardBody>
            <CommentThread base={base} subjectType="meeting" subjectId={m.id} people={peopleLite} me={viewer.user.id} canPost={perms.post} canManage={perms.manage} />
          </CardBody>
        </Card>
        {editable ? (
          <Card>
            <details>
              <summary className="cursor-pointer p-4 text-sm font-medium">{t("communication.meetings.editDetails")}</summary>
              <MeetingForm
                base={base}
                locale={locale}
                me={m.organizerId}
                people={peopleLite}
                initial={{ id: m.id, title: m.title, agenda: m.agenda ?? "", location: m.location ?? "", startsAt: m.startsAt.toISOString(), endsAt: m.endsAt.toISOString(), attendeeIds: m.attendees.map((a) => a.userId).filter((u) => u !== m.organizerId) }}
              />
            </details>
          </Card>
        ) : null}
      </div>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={t("communication.meetings.attendeesCount", { count: m.attendees.length })} />
          <ul className="grid divide-y">
            {m.attendees.map((a) => (
              <li key={a.userId} className="flex items-center justify-between px-4 py-1.5 text-sm">
                <span>{a.name ?? "?"}</span>
                {a.userId === m.organizerId ? <Badge>{t("communication.meetings.organizer")}</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
        {perms.runAgents ? (
          <AiTasksCard
            t={t}
            locale={locale}
            tz={tz}
            title={t("communication.meetings.ai.title")}
            description={t("communication.meetings.ai.description")}
            tasks={tasks}
            notConfigured={!perms.aiReady}
            actions={<AiButtons path={`${path}/summarize`} modes={[{ mode: "summarize", label: t("communication.meetings.ai.summarize") }]} />}
            extra={editable ? (task) => <ActionItemsFromSummary base={base} meetingId={m.id} taskId={task.id} attendees={attendees} /> : undefined}
          />
        ) : null}
        {perms.post ? (
          <Card>
            <CardHeader title={t("communication.share.title")} description={t("communication.share.meetingDescription")} />
            <CardBody>
              <ShareToChat base={base} subjectType="meeting" subjectId={m.id} connected={{ slack: conns.slack === "CONNECTED", microsoft_teams: conns.microsoft_teams === "CONNECTED" }} />
            </CardBody>
          </Card>
        ) : null}
        {!perms.runAgents ? <Notice>{t("communication.ai.noPermission")}</Notice> : null}
        <Link href={`/${locale}/communication/meetings`} className="text-sm hover:underline">
          ← {t("communication.meetings.back")}
        </Link>
      </div>
    </div>,
  );
}
