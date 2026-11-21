import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions, namedOptions, peopleOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { enumParam } from "@/server/modules/hr/access";
import { employeeOptions } from "@/server/modules/hr/employees";
import { CHECKLIST_CATEGORIES, CHECKLIST_KINDS, listChecklists, listTemplates, OWNER_ROLES } from "@/server/modules/hr/onboarding";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.onboarding") };
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.manage;
  const frame = { t, locale, title: t("hr.onboarding.title"), subtitle: t("hr.onboarding.subtitle"), tab: "onboarding" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const raw = await searchParams;
  const kind = enumParam(raw, "kind", CHECKLIST_KINDS);
  const status = enumParam(raw, "status", ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) ?? (raw.status === "all" ? undefined : "IN_PROGRESS");
  const [lists, templates, people] = await Promise.all([listChecklists(viewer.ctx, org.id, company.id, { kind, status }), listTemplates(viewer.ctx, org.id, company.id), employeeOptions(viewer.ctx, org.id, company.id)]);
  return (
    <HrFrame
      {...frame}
      actions={
        <Link href={`/${locale}/hr/onboarding/assets`} className="text-sm text-primary hover:underline">
          {t("hr.assets.register")}
        </Link>
      }
    >
      <Card>
        <CardHeader title={t("hr.onboarding.checklists")} description={t("hr.onboarding.count", { count: lists.length })} />
        <form className="flex flex-wrap gap-2 border-b p-3" action={`/${locale}/hr/onboarding`}>
          <Select name="kind" defaultValue={kind ?? ""} className="w-44" aria-label={t("hr.onboarding.kind")}>
            <option value="">{t("hr.onboarding.allKinds")}</option>
            {CHECKLIST_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`hr.checklistKind.${k}`)}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={raw.status === "all" ? "all" : (status ?? "")} className="w-44" aria-label={t("common.status")}>
            <option value="all">{t("common.all")}</option>
            {(["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`hr.checklistStatus.${k}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("hr.apply")}
          </Button>
        </form>
        <details className="border-b">
          <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.onboarding.start")}</summary>
          <HrForm
            className="px-3 pb-3"
            endpoint={`${base}/hr/checklists`}
            fields={[
              { name: "employeeId", label: t("hr.employee"), type: "select", required: true, options: peopleOptions(people) },
              { name: "kind", label: t("hr.onboarding.kind"), type: "select", required: true, options: enumOptions(t, "hr.checklistKind", CHECKLIST_KINDS) },
              { name: "templateId", label: t("hr.onboarding.template"), type: "select", options: namedOptions(templates), hint: t("hr.onboarding.templateHint") },
              { name: "startDate", label: t("hr.startDate"), type: "date" },
            ]}
            initial={{ kind: "ONBOARDING" }}
            submitLabel={t("hr.onboarding.start")}
          />
        </details>
        {lists.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("hr.employee")}</Th>
                <Th>{t("hr.onboarding.kind")}</Th>
                <Th>{t("hr.startDate")}</Th>
                <Th>{t("hr.onboarding.progressLabel")}</Th>
                <Th>{t("common.status")}</Th>
              </Tr>
            </THead>
            <TBody>
              {lists.map((l) => (
                <Tr key={l.id}>
                  <Td>
                    <Link href={`/${locale}/hr/onboarding/${l.id}`} className="font-medium hover:underline">
                      {personName(l.employee)}
                    </Link>
                    <div className="text-xs text-muted-foreground">{l.employee.title}</div>
                  </Td>
                  <Td>{t(`hr.checklistKind.${l.kind}`)}</Td>
                  <Td>{formatDate(l.startDate, locale, "UTC")}</Td>
                  <Td className="min-w-32">
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${l.percent}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{t("hr.onboarding.progress", { done: l.done, total: l.total })}</span>
                  </Td>
                  <Td>
                    <Badge tone={l.status === "COMPLETED" ? "success" : l.status === "CANCELLED" ? "neutral" : "accent"}>{t(`hr.checklistStatus.${l.status}`)}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("hr.onboarding.none")}</p>
        )}
      </Card>

      <Card>
        <CardHeader title={t("hr.onboarding.templates")} description={t("hr.onboarding.templatesHint")} />
        <CardBody className="grid gap-3">
          {templates.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {templates.map((tpl) => (
                <section key={tpl.id} className="grid gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{tpl.name}</span>
                    <Badge>{t(`hr.checklistKind.${tpl.kind}`)}</Badge>
                    {tpl.isDefault ? <Badge tone="success">{t("hr.onboarding.default")}</Badge> : <ActionButton endpoint={`${base}/hr/checklist-templates/${tpl.id}`} method="PATCH" body={{ isDefault: true }} label={t("hr.onboarding.makeDefault")} variant="ghost" />}
                    <span className="ms-auto">
                      <ActionButton endpoint={`${base}/hr/checklist-templates/${tpl.id}`} method="DELETE" label={t("hr.archive")} variant="ghost" confirm={t("hr.confirmArchive")} />
                    </span>
                  </div>
                  {tpl.description ? <p className="text-xs text-muted-foreground">{tpl.description}</p> : null}
                  <ol className="grid gap-1 text-sm">
                    {tpl.tasks.map((task) => (
                      <li key={task.id} className="flex flex-wrap items-center gap-2">
                        <span>{task.title}</span>
                        <Badge>{t(`hr.category.${task.category}`)}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {t(`hr.ownerRole.${task.ownerRole}`)} · {t("hr.onboarding.dueDays", { count: task.dueDays })}
                        </span>
                        <ActionButton endpoint={`${base}/hr/checklist-template-tasks/${task.id}`} method="DELETE" label="×" variant="ghost" />
                      </li>
                    ))}
                  </ol>
                  <details>
                    <summary className="cursor-pointer text-xs text-primary">{t("hr.onboarding.addStep")}</summary>
                    <HrForm
                      className="mt-2"
                      endpoint={`${base}/hr/checklist-templates/${tpl.id}/tasks`}
                      fields={[
                        { name: "title", label: t("hr.onboarding.step"), required: true, full: true },
                        { name: "category", label: t("hr.onboarding.categoryLabel"), type: "select", required: true, options: enumOptions(t, "hr.category", CHECKLIST_CATEGORIES) },
                        { name: "ownerRole", label: t("hr.onboarding.owner"), type: "select", required: true, options: enumOptions(t, "hr.ownerRole", OWNER_ROLES) },
                        { name: "dueDays", label: t("hr.onboarding.dueDaysLabel"), type: "number", min: -90, max: 365, hint: t("hr.onboarding.dueDaysHint") },
                      ]}
                      initial={{ category: "GENERAL", ownerRole: "HR", dueDays: 0 }}
                      submitLabel={t("hr.add")}
                    />
                  </details>
                </section>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("hr.onboarding.noTemplates")}</p>
          )}
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("hr.onboarding.addTemplate")}</summary>
            <HrForm
              className="mt-3"
              endpoint={`${base}/hr/checklist-templates`}
              fields={[
                { name: "name", label: t("hr.org.name"), required: true },
                { name: "kind", label: t("hr.onboarding.kind"), type: "select", required: true, options: enumOptions(t, "hr.checklistKind", CHECKLIST_KINDS) },
                { name: "isDefault", label: t("hr.onboarding.default"), type: "checkbox", hint: t("hr.onboarding.defaultHint") },
                { name: "description", label: t("hr.org.description"), type: "textarea", rows: 2 },
              ]}
              initial={{ kind: "ONBOARDING" }}
              submitLabel={t("common.create")}
            />
          </details>
        </CardBody>
      </Card>
      <p className="text-xs text-muted-foreground">{t("hr.onboarding.tasksHint", { tz })}</p>
    </HrFrame>
  );
}
