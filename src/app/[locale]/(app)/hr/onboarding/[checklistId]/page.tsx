import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { cn } from "@/lib/utils";
import { formatDate } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { CHECKLIST_CATEGORIES, getChecklist, OWNER_ROLES } from "@/server/modules/hr/onboarding";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.onboarding.checklist") };
}

export default async function ChecklistPage({ params }: { params: Promise<{ checklistId: string }> }) {
  const { checklistId } = await params;
  const locale = await getLocale();
  const { t, viewer, org, company, access, base } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.onboarding.checklist"), tab: (access?.manage ? "onboarding" : "me") as "onboarding" | "me", access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const list = await getChecklist(viewer.ctx, org.id, company.id, checklistId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const manage = access!.manage;
  const isSelf = access!.me?.id === list.employeeId;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const active = list.status !== "CANCELLED";
  return (
    <HrFrame
      {...frame}
      title={`${t(`hr.checklistKind.${list.kind}`)}: ${personName(list.employee)}`}
      subtitle={[list.employee.title, t("hr.onboarding.startedOn", { date: formatDate(list.startDate, locale, "UTC") }), list.template?.name].filter(Boolean).join(" · ")}
      actions={
        <>
          <Badge tone={list.status === "COMPLETED" ? "success" : list.status === "CANCELLED" ? "neutral" : "accent"}>{t(`hr.checklistStatus.${list.status}`)}</Badge>
          {manage && list.status === "IN_PROGRESS" ? <ActionButton endpoint={`${base}/hr/checklists/${list.id}`} method="DELETE" label={t("hr.onboarding.cancel")} variant="ghost" confirm={t("hr.onboarding.cancelConfirm")} /> : null}
          <Link href={`/${locale}/hr/employees/${list.employee.id}?tab=onboarding`} className="text-sm text-muted-foreground hover:underline">
            {t("hr.employees.profile")}
          </Link>
        </>
      }
    >
      <Card>
        <CardHeader title={t("hr.onboarding.progress", { done: list.done, total: list.total })} />
        <CardBody className="grid gap-3">
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${list.percent}%` }} />
          </div>
          <ul className="grid divide-y rounded-md border">
            {list.items.map((item) => {
              const done = !!item.completedAt || (item.workTaskId ? list.taskStatus.get(item.workTaskId) === "DONE" : false);
              const overdue = !done && item.dueDate && item.dueDate < today;
              const canToggle = active && (manage || (isSelf && item.ownerRole === "EMPLOYEE"));
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span aria-hidden className={cn("inline-flex size-5 items-center justify-center rounded-full border text-xs", done && "border-success bg-success/10 text-success")}>
                    {done ? "✓" : ""}
                  </span>
                  <span className={cn("min-w-0 flex-1", done && "text-muted-foreground line-through")}>{item.title}</span>
                  <Badge>{t(`hr.category.${item.category}`)}</Badge>
                  <span className="text-xs text-muted-foreground">{t(`hr.ownerRole.${item.ownerRole}`)}</span>
                  {item.dueDate ? <span className={cn("text-xs", overdue ? "text-warning" : "text-muted-foreground")}>{formatDate(item.dueDate, locale, "UTC")}</span> : null}
                  {item.workTaskId ? (
                    <Link href={`/${locale}/projects`} className="text-[11px] text-muted-foreground hover:underline" title={t("hr.onboarding.workTask")}>
                      {t("hr.onboarding.workTaskShort")}
                    </Link>
                  ) : null}
                  {canToggle ? <ActionButton endpoint={`${base}/hr/checklist-items/${item.id}`} method="PATCH" body={{ done: !done }} label={done ? t("hr.onboarding.reopen") : t("hr.onboarding.markDone")} variant={done ? "ghost" : "secondary"} /> : null}
                </li>
              );
            })}
          </ul>
          {manage && active ? (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("hr.onboarding.addStep")}</summary>
              <HrForm
                className="mt-3"
                endpoint={`${base}/hr/checklists/${list.id}/items`}
                fields={[
                  { name: "title", label: t("hr.onboarding.step"), required: true, full: true },
                  { name: "category", label: t("hr.onboarding.categoryLabel"), type: "select", required: true, options: enumOptions(t, "hr.category", CHECKLIST_CATEGORIES) },
                  { name: "ownerRole", label: t("hr.onboarding.owner"), type: "select", required: true, options: enumOptions(t, "hr.ownerRole", OWNER_ROLES) },
                  { name: "dueDate", label: t("hr.dueDate"), type: "date" },
                ]}
                initial={{ category: "GENERAL", ownerRole: "HR" }}
                submitLabel={t("hr.add")}
              />
            </details>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("hr.onboarding.syncHint")}</p>
        </CardBody>
      </Card>
    </HrFrame>
  );
}
