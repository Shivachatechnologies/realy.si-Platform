import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate, formatDateTime, formatNumber } from "@/i18n/format";
import { subjectWorkspace, type SubjectType } from "@/server/modules/crm/activities";
import { leadAttachments } from "@/server/modules/crm/activities";
import { AttachmentUpload, CrmActivityForm, CrmFollowUpForm, FollowUpToggle } from "./activity-forms";
import { ActionButton, type Owner } from "./kit";
import { crmContext } from "./shell";

const ICON = { CALL: "☎", EMAIL: "✉", MEETING: "◷", NOTE: "✎", TASK: "☐" } as const;
const PRIORITY_TONE = { HIGH: "danger", MEDIUM: "warning", LOW: "neutral" } as const;

const size = (n: number, locale: string) => (n >= 1_048_576 ? `${formatNumber(n / 1_048_576, locale, { maximumFractionDigits: 1 })} MB` : `${formatNumber(Math.ceil(n / 1024), locale)} KB`);

/** Follow-ups, activity timeline and attachments of a contact, account or deal. */
export async function SubjectActivity({ subjectType, subjectId, owners, active, defaultAssignee }: { subjectType: SubjectType; subjectId: string; owners: Owner[]; active: boolean; defaultAssignee?: string | null }) {
  const c = await crmContext();
  if (!c.company) return null;
  const { t, locale, tz, base } = c;
  const w = await subjectWorkspace(c.viewer.ctx, c.org.id, c.company.id, subjectType, subjectId);
  const edit = c.canManage && active;
  const now = new Date();
  return (
    <>
      <Card>
        <CardHeader title={t("crm.followUps")} description={t("crm.followUpsHint")} />
        <CardBody className="grid gap-3">
          {w.followUps.length ? (
            <ul className="grid gap-1.5">
              {w.followUps.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                  {edit ? <FollowUpToggle base={base} id={f.id} completed={!!f.completedAt} /> : <span aria-hidden>{f.completedAt ? "✓" : "○"}</span>}
                  <Badge tone={f.completedAt ? "neutral" : PRIORITY_TONE[f.priority]}>{t(`crm.priorities.${f.priority}`)}</Badge>
                  <span className={f.completedAt ? "text-muted-foreground line-through" : ""}>{f.note}</span>
                  <span className={!f.completedAt && f.dueAt < now ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
                    {!f.completedAt && f.dueAt < now ? t("crm.overdueOn", { date: formatDateTime(f.dueAt, locale, tz) }) : formatDateTime(f.dueAt, locale, tz)}
                  </span>
                  {f.assigneeName ? <span className="text-xs text-muted-foreground">· {f.assigneeName}</span> : null}
                  {edit ? <ActionButton url={`${base}/crm/follow-ups/${f.id}`} method="DELETE" size="icon" icon="trash" label={t("crm.delete")} confirm={t("crm.deleteConfirm")} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("crm.noFollowUps")}</p>
          )}
          {edit ? <CrmFollowUpForm base={base} subjectType={subjectType} subjectId={subjectId} owners={owners} defaultAssignee={defaultAssignee ?? undefined} /> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("crm.timeline")} description={subjectType === "account" ? t("crm.activities.accountHint") : t("crm.activities.hint")} />
        <CardBody className="grid gap-4">
          {edit ? <CrmActivityForm base={base} subjectType={subjectType} subjectId={subjectId} /> : null}
          {w.activities.length ? (
            <ol className="grid gap-3 border-s ps-4">
              {w.activities.map((a) => (
                <li key={a.id} className="grid gap-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span aria-hidden>{ICON[a.type]}</span>
                    <span className="font-medium text-foreground">{t(`crm.activityTypes.${a.type}`)}</span>
                    {formatDateTime(a.occurredAt, locale, tz)}
                    {a.durationMin ? <span>· {t("crm.activities.minutes", { count: a.durationMin })}</span> : null}
                    {a.author ? <span>· {a.author}</span> : null}
                    {subjectType !== "deal" && a.deal ? (
                      <Link href={`/${locale}/crm/deals/${a.deal.id}`} className="hover:underline">
                        · {a.deal.name}
                      </Link>
                    ) : null}
                    {subjectType === "account" && a.contact ? (
                      <Link href={`/${locale}/crm/contacts/${a.contact.id}`} className="hover:underline">
                        · {[a.contact.firstName, a.contact.lastName].filter(Boolean).join(" ")}
                      </Link>
                    ) : null}
                    {edit ? <ActionButton url={`${base}/crm/activities/${a.id}`} method="DELETE" size="icon" icon="trash" label={t("crm.delete")} confirm={t("crm.deleteConfirm")} /> : null}
                  </span>
                  {a.subject ? <p className="font-medium">{a.subject}</p> : null}
                  <p className="whitespace-pre-wrap">{a.summary}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t("crm.noActivities")}</p>
          )}
        </CardBody>
      </Card>

      <AttachmentList subjectType={subjectType} subjectId={subjectId} files={w.attachments} active={active} />
    </>
  );
}

/** Attachments card (also used on lead pages). */
export async function AttachmentList({
  subjectType,
  subjectId,
  files,
  active,
}: {
  subjectType: "lead" | "contact" | "account" | "deal";
  subjectId: string;
  files?: { id: string; name: string; size: number; mimeType: string; createdAt: Date; author: string | null }[];
  active: boolean;
}) {
  const c = await crmContext();
  if (!c.company) return null;
  const { t, locale, tz, base } = c;
  const list = files ?? (await leadAttachments(c.viewer.ctx, c.org.id, c.company.id, subjectId));
  const edit = c.canManage && active;
  return (
    <Card>
      <CardHeader title={t("crm.attachments.title")} />
      <CardBody className="grid gap-3">
        {list.length ? (
          <ul className="grid gap-1.5 text-sm">
            {list.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <a href={`${base}/crm/attachments/${f.id}`} className="font-medium hover:underline" download>
                  {f.name}
                </a>
                <span className="text-xs text-muted-foreground">
                  {size(f.size, locale)} · {formatDate(f.createdAt, locale, tz)}
                  {f.author ? ` · ${f.author}` : ""}
                </span>
                {edit ? <ActionButton url={`${base}/crm/attachments/${f.id}`} method="DELETE" size="icon" icon="trash" label={t("crm.delete")} confirm={t("crm.deleteConfirm")} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("crm.attachments.none")}</p>
        )}
        {edit ? <AttachmentUpload base={base} subjectType={subjectType} subjectId={subjectId} /> : null}
      </CardBody>
    </Card>
  );
}
