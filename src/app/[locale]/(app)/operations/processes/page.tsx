import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { workContext } from "@/components/work/context";
import { ProcessForm } from "@/components/work/ops-forms";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { OpsHeader, OpsIntro } from "@/components/ops-hub/ops-visuals";
import { ProcessWizard } from "@/components/ops-hub/process-wizard";
import { CardBody } from "@/components/ui/card";
import { Workflow } from "lucide-react";
import { getDraft } from "@/server/modules/cockpit/drafts";
import { Empty, Pagination } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { listProcesses } from "@/server/modules/work/operations";
import { listPeople, param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.tabs.processes") };
}

export default async function ProcessesPage({ searchParams }: PageProps<"/[locale]/operations/processes">) {
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"), t("work.ops.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const raw = await searchParams;
  const path = `/${locale}/operations/processes`;
  const [list, people, draft] = await Promise.all([
    listProcesses(viewer.ctx, org.id, company.id, raw),
    canManage ? listPeople(viewer.ctx, org.id, company.id, "operations.read") : [],
    canManage ? getDraft(viewer.ctx, org.id, company.id, "ops.process").catch(() => null) : null,
  ]);
  const filtered = !!(param(raw, "q") || param(raw, "category") || param(raw, "archived"));
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      <OpsHeader t={t} locale={locale} active="processes" />
      <OpsIntro t={t} page="processes" next={canManage ? { label: t("opsHub.process.title"), href: "#start" } : undefined} />
      {canManage ? (
        <Card variant={list.total === 0 && !filtered ? "highlight" : "default"} id="start" className="scroll-mt-20">
          <details open={(list.total === 0 && !filtered) || !!draft}>
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold">
              <Workflow className="size-4 text-primary" aria-hidden /> {t("opsHub.process.title")}
              <span className="text-xs font-normal text-muted-foreground">{t("opsHub.process.subtitle")}</span>
            </summary>
            <CardBody className="border-t">
              <ProcessWizard base={base} locale={locale} people={people} draft={draft ? { step: draft.step, data: draft.data } : null} />
            </CardBody>
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("work.ops.tabs.processes")} description={t("work.ops.processesHint")} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_12rem_9rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={param(raw, "q") ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.search")} />
          <Select name="category" defaultValue={param(raw, "category") ?? ""} aria-label={t("work.ops.category")}>
            <option value="">{t("work.ops.allCategories")}</option>
            {list.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select name="archived" defaultValue={param(raw, "archived") ?? ""} aria-label={t("work.archived")}>
            <option value="">{t("work.activeOnly")}</option>
            <option value="1">{t("work.archived")}</option>
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              {t("work.apply")}
            </Button>
            {filtered ? (
              <Link href={path} className="self-center text-xs text-muted-foreground hover:underline">
                {t("work.clear")}
              </Link>
            ) : null}
          </div>
        </form>
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("opsHub.quickAdd")}</summary>
            <ProcessForm base={base} locale={locale} people={people} />
          </details>
        ) : null}
        {list.data.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("work.ops.processTitle")}</Th>
                <Th>{t("work.ops.category")}</Th>
                <Th>{t("work.ops.owner")}</Th>
                <Th>{t("work.ops.version")}</Th>
                <Th>{t("work.ops.updated")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/${locale}/operations/processes/${p.id}`} className="font-medium hover:underline">
                      {p.title}
                    </Link>
                  </Td>
                  <Td>{p.category ? <Badge>{p.category}</Badge> : "—"}</Td>
                  <Td className="text-muted-foreground">{p.ownerName ?? "—"}</Td>
                  <Td className="text-muted-foreground">v{p.currentVersion}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDate(p.updatedAt, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          filtered ? (
            <Empty>{t("common.noResults")}</Empty>
          ) : (
            <SmartEmpty icon={<Workflow />} title={t("opsHub.empty.processes.title")} body={t("opsHub.empty.processes.body")} primary={canManage ? <a href="#start" className="text-sm font-medium text-primary hover:underline">{t("opsHub.process.title")}</a> : undefined} />
          )
        )}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
