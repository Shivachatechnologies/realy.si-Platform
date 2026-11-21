import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { workContext } from "@/components/work/context";
import { IncidentEditForm } from "@/components/work/ops-forms";
import { Facts, INCIDENT_TONE, SEVERITY_TONE } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { getIncident } from "@/server/modules/work/operations";
import { listPeople } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.incident") };
}

export default async function IncidentPage({ params }: PageProps<"/[locale]/operations/incidents/[incidentId]">) {
  const { incidentId } = await params;
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const i = await getIncident(viewer.ctx, org.id, company.id, incidentId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const people = canManage ? await listPeople(viewer.ctx, org.id, company.id, "operations.read") : [];
  const durationMin = i.resolvedAt ? Math.round((i.resolvedAt.getTime() - i.occurredAt.getTime()) / 60_000) : null;
  return (
    <div className="mx-auto grid max-w-[1000px] min-w-0 gap-4">
      <Link href={`/${locale}/operations/incidents`} className="text-sm text-muted-foreground hover:underline">
        ← {t("work.ops.tabs.incidents")}
      </Link>
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={SEVERITY_TONE[i.severity]}>{t(`work.ops.severities.${i.severity}`)}</Badge>
              {i.title}
              <Badge tone={INCIDENT_TONE[i.status]}>{t(`work.ops.incidentStatus.${i.status}`)}</Badge>
            </span>
          }
        />
        <CardBody className="grid gap-4">
          <Facts
            cols={4}
            items={[
              [t("work.ops.occurredAt"), formatDateTime(i.occurredAt, locale, tz)],
              [t("work.ops.resolvedAt"), i.resolvedAt ? formatDateTime(i.resolvedAt, locale, tz) : "—"],
              [t("work.ops.timeToResolve"), durationMin != null ? t("work.ops.duration", { hours: Math.floor(durationMin / 60), minutes: durationMin % 60 }) : "—"],
              [t("work.ops.owner"), i.ownerName ?? "—"],
              [t("work.task.project"), i.project ? <Link key="p" href={`/${locale}/projects/${i.project.id}`} className="hover:underline">{i.project.name}</Link> : "—"],
              [t("work.ops.reportedBy"), i.createdByName ?? "—"],
            ]}
          />
          {canManage ? (
            <IncidentEditForm base={base} incidentId={i.id} people={people} initial={{ title: i.title, description: i.description ?? "", severity: i.severity, status: i.status, ownerId: i.ownerId ?? "", postmortem: i.postmortem ?? "" }} />
          ) : (
            <>
              {i.description ? <p className="whitespace-pre-wrap text-sm">{i.description}</p> : null}
              <div className="grid gap-1">
                <h3 className="text-sm font-medium">{t("work.ops.postmortem")}</h3>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{i.postmortem ?? t("work.ops.noPostmortem")}</p>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
