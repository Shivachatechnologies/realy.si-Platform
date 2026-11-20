import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { IncidentBoard, OpsHeader, OpsIntro } from "@/components/ops-hub/ops-visuals";
import { Term } from "@/components/guide-kit/term";
import { CardBody } from "@/components/ui/card";
import { Siren } from "lucide-react";
import { incidentBoard } from "@/server/modules/cockpit/ops-insights";
import { workContext } from "@/components/work/context";
import { IncidentForm } from "@/components/work/ops-forms";
import { Empty, INCIDENT_TONE, Pagination, SEVERITY_TONE } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { listProjects } from "@/server/modules/companies/service";
import { INCIDENT_STATUSES, listIncidents, SEVERITIES } from "@/server/modules/work/operations";
import { listPeople, param } from "@/server/modules/work/shared";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { db } from "@/server/core/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.tabs.incidents") };
}


export default async function IncidentsPage({ searchParams }: PageProps<"/[locale]/operations/incidents">) {
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"), t("work.ops.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const raw = await searchParams;
  const path = `/${locale}/operations/incidents`;
  const canProjects = await can(viewer.ctx, "projects.read", await companyChain(db(), org.id, company.id));
  const [list, people, projects, board] = await Promise.all([
    listIncidents(viewer.ctx, org.id, company.id, raw),
    canManage ? listPeople(viewer.ctx, org.id, company.id, "operations.read") : [],
    canManage && canProjects ? listProjects(viewer.ctx, org.id, company.id) : [],
    incidentBoard(viewer.ctx, org.id, company.id),
  ]);
  const filtered = !!(param(raw, "q") || param(raw, "status") || param(raw, "severity"));
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      <OpsHeader t={t} locale={locale} active="incidents" />
      <OpsIntro t={t} page="incidents" next={canManage ? { label: t("work.ops.logIncident"), href: "#log" } : undefined} />
      <Card>
        <CardHeader
          icon={<Siren />}
          title={t("opsHub.incidents.boardTitle")}
          description={
            <Term explain={t("opsHub.incidents.severityExplain")} label={t("opsHub.whatsThis")}>
              {t("opsHub.incidents.severityWord")}
            </Term>
          }
        />
        <CardBody>
          <IncidentBoard incidents={board} t={t} locale={locale} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("work.ops.tabs.incidents")} description={t("work.ops.incidentsHint")} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={param(raw, "q") ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.search")} />
          <Select name="status" defaultValue={param(raw, "status") ?? ""} aria-label={t("work.task.status")}>
            <option value="">{t("work.allStatuses")}</option>
            <option value="open">{t("work.ops.unresolved")}</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`work.ops.incidentStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="severity" defaultValue={param(raw, "severity") ?? ""} aria-label={t("work.ops.severity")}>
            <option value="">{t("work.ops.anySeverity")}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t(`work.ops.severities.${s}`)}
              </option>
            ))}
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
          <details className="scroll-mt-20 border-b" id="log">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.ops.logIncident")}</summary>
            <IncidentForm base={base} locale={locale} people={people} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          </details>
        ) : null}
        {list.data.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("work.ops.severity")}</Th>
                <Th>{t("work.ops.incidentTitle")}</Th>
                <Th>{t("work.task.status")}</Th>
                <Th>{t("work.ops.owner")}</Th>
                <Th>{t("work.ops.occurredAt")}</Th>
                <Th>{t("work.ops.resolvedAt")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge>
                  </Td>
                  <Td>
                    <Link href={`/${locale}/operations/incidents/${i.id}`} className="font-medium hover:underline">
                      {i.title}
                    </Link>
                    {i.project ? <span className="ms-2 text-xs text-muted-foreground">{i.project.name}</span> : null}
                  </Td>
                  <Td>
                    <Badge tone={INCIDENT_TONE[i.status]}>{t(`work.ops.incidentStatus.${i.status}`)}</Badge>
                  </Td>
                  <Td className="text-muted-foreground">{i.ownerName ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(i.occurredAt, locale, tz)}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{i.resolvedAt ? formatDateTime(i.resolvedAt, locale, tz) : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          filtered ? (
            <Empty>{t("common.noResults")}</Empty>
          ) : (
            <SmartEmpty icon={<Siren />} title={t("opsHub.empty.incidents.title")} body={t("opsHub.empty.incidents.body")} />
          )
        )}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
