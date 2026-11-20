import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { OpsTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { ChecklistForm } from "@/components/work/ops-forms";
import { Empty, Progress } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { listChecklists, SCHEDULES } from "@/server/modules/work/operations";
import { listPeople, param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.tabs.checklists") };
}

export default async function ChecklistsPage({ searchParams }: PageProps<"/[locale]/operations/checklists">) {
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"), t("work.ops.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base } = w;
  const raw = await searchParams;
  const path = `/${locale}/operations/checklists`;
  const [rows, people] = await Promise.all([listChecklists(viewer.ctx, org.id, company.id, raw), canManage ? listPeople(viewer.ctx, org.id, company.id, "operations.read") : []]);
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <OpsTabs t={t} locale={locale} active="checklists" />
      <Card>
        <CardHeader title={t("work.ops.tabs.checklists")} description={t("work.ops.checklistsHint")} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={param(raw, "q") ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.search")} />
          <Select name="schedule" defaultValue={param(raw, "schedule") ?? ""} aria-label={t("work.ops.schedule")}>
            <option value="">{t("work.ops.anySchedule")}</option>
            {SCHEDULES.map((s) => (
              <option key={s} value={s}>
                {t(`work.ops.schedules.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="archived" defaultValue={param(raw, "archived") ?? ""} aria-label={t("work.archived")}>
            <option value="">{t("work.activeOnly")}</option>
            <option value="1">{t("work.archived")}</option>
          </Select>
          <Button type="submit" variant="secondary">
            {t("work.apply")}
          </Button>
        </form>
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.ops.addChecklist")}</summary>
            <ChecklistForm base={base} locale={locale} people={people} />
          </details>
        ) : null}
        {rows.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("work.ops.checklistTitle")}</Th>
                <Th>{t("work.ops.schedule")}</Th>
                <Th>{t("work.ops.nextRun")}</Th>
                <Th>{t("work.task.assignee")}</Th>
                <Th className="min-w-40">{t("work.ops.lastRun")}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`/${locale}/operations/checklists/${c.id}`} className="font-medium hover:underline">
                      {c.title}
                    </Link>
                    <span className="ms-2 text-xs text-muted-foreground">{t("work.ops.itemCount", { count: c.itemCount })}</span>
                  </Td>
                  <Td>
                    <Badge>{t(`work.ops.schedules.${c.schedule}`)}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{c.nextRunOn ? formatDate(c.nextRunOn, locale, "UTC") : "—"}</Td>
                  <Td className="text-muted-foreground">{c.assigneeName ?? "—"}</Td>
                  <Td>
                    {c.lastRun ? (
                      <div className="grid gap-0.5">
                        <Progress value={c.lastRun.total ? (c.lastRun.done / c.lastRun.total) * 100 : 0} label={t("work.ops.runProgress", { done: c.lastRun.done, total: c.lastRun.total })} />
                        <span className="text-xs text-muted-foreground">{formatDate(c.lastRun.dueOn, locale, "UTC")}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("work.ops.noRuns")}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>{t("work.ops.noChecklists")}</Empty>
        )}
      </Card>
    </div>
  );
}
