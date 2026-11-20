import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton } from "@/components/work/actions";
import { workContext } from "@/components/work/context";
import { ChecklistForm, RunItemToggle } from "@/components/work/ops-forms";
import { Facts, Progress } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { getChecklist } from "@/server/modules/work/operations";
import { listPeople } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.checklist") };
}

export default async function ChecklistPage({ params }: PageProps<"/[locale]/operations/checklists/[checklistId]">) {
  const { checklistId } = await params;
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const c = await getChecklist(viewer.ctx, org.id, company.id, checklistId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const people = canManage ? await listPeople(viewer.ctx, org.id, company.id, "operations.read") : [];
  const [current, ...past] = c.runs;
  const openRun = current && !current.completedAt ? current : null;
  const history = openRun ? past : c.runs;
  return (
    <div className="mx-auto grid max-w-[1100px] min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/${locale}/operations/checklists`} className="text-sm text-muted-foreground hover:underline">
          ← {t("work.ops.tabs.checklists")}
        </Link>
        <span className="flex flex-wrap gap-2">
          {!c.archivedAt ? (
            <ActionButton url={`${base}/operations/checklists/${c.id}/runs`}>
              <Play aria-hidden />
              {t("work.ops.startRun")}
            </ActionButton>
          ) : null}
          {canManage ? (
            <ActionButton url={`${base}/operations/checklists/${c.id}`} method="PATCH" body={{ archived: !c.archivedAt }} confirm={c.archivedAt ? undefined : t("work.confirmArchive")}>
              {c.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {c.archivedAt ? t("work.restore") : t("work.archive")}
            </ActionButton>
          ) : null}
        </span>
      </div>
      {c.archivedAt ? <Notice tone="warning">{t("work.archivedNotice")}</Notice> : null}
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {c.title}
              <Badge>{t(`work.ops.schedules.${c.schedule}`)}</Badge>
            </span>
          }
          description={c.description ?? undefined}
        />
        <CardBody className="grid gap-4">
          <Facts items={[[t("work.ops.nextRun"), c.nextRunOn ? formatDate(c.nextRunOn, locale, "UTC") : "—"], [t("work.task.assignee"), c.assigneeName ?? "—"], [t("work.ops.items"), c.items.length]]} />
          {canManage && !c.archivedAt ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">{t("work.ops.editChecklist")}</summary>
              <ChecklistForm
                base={base}
                locale={locale}
                people={people}
                checklistId={c.id}
                initial={{ title: c.title, description: c.description ?? "", items: c.items.map((i) => i.text).join("\n"), schedule: c.schedule, nextRunOn: c.nextRunOn ? c.nextRunOn.toISOString().slice(0, 10) : "", assigneeId: c.assigneeId ?? "" }}
              />
            </details>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={openRun ? t("work.ops.currentRun", { date: formatDate(openRun.dueOn, locale, "UTC") }) : t("work.ops.noOpenRun")} />
        <CardBody className="grid gap-3">
          {openRun ? (
            <>
              <Progress value={(openRun.items.filter((i) => i.done).length / Math.max(1, openRun.items.length)) * 100} label={t("work.ops.runProgress", { done: openRun.items.filter((i) => i.done).length, total: openRun.items.length })} />
              <ul className="grid gap-2">
                {openRun.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <RunItemToggle base={base} runId={openRun.id} itemId={i.id} done={i.done} label={i.text} />
                    {i.done && i.doneById ? <span className="text-xs text-muted-foreground">{c.names[i.doneById] ?? ""}{i.doneAt ? ` · ${formatDateTime(i.doneAt, locale, tz)}` : ""}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("work.ops.noOpenRunHint")}</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("work.ops.runHistory")} />
        {history.length ? (
          <ul className="grid divide-y">
            {history.map((r) => {
              const done = r.items.filter((i) => i.done).length;
              return (
                <li key={r.id} className="grid gap-1 px-4 py-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_10rem] sm:items-center">
                  <span>{formatDate(r.dueOn, locale, "UTC")}</span>
                  <Progress value={(done / Math.max(1, r.items.length)) * 100} label={t("work.ops.runProgress", { done, total: r.items.length })} />
                  <span className="text-xs text-muted-foreground">{r.completedAt ? t("work.ops.completedOn", { date: formatDateTime(r.completedAt, locale, tz) }) : t("work.ops.incomplete")}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("work.ops.noRuns")}</p>
        )}
      </Card>
    </div>
  );
}
