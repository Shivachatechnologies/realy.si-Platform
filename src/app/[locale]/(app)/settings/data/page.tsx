import type { Metadata } from "next";
import { Download } from "lucide-react";
import { DeletionActions, RequestDeletion, RetentionForm } from "@/components/enterprise/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain, orgChain } from "@/server/modules/rbac/scope";
import { DELETION_GRACE_DAYS, listDataRequests } from "@/server/modules/enterprise/data";
import { getOrgSettings } from "@/server/modules/enterprise/policy";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.tabs.data") };
}

const TONE = {
  PENDING: "warning",
  SCHEDULED: "danger",
  CANCELLED: "neutral",
  COMPLETED: "success",
} as const;

export default async function DataPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const oc = orgChain(org.id);
  if (!(await can(viewer.ctx, "organizations.read", oc))) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
  const chain = company ? await companyChain(db(), org.id, company.id) : null;
  const [canManageOrg, settings, canRequest, canConfirm, requests] = await Promise.all([
    can(viewer.ctx, "organizations.manage", oc),
    getOrgSettings(org.id),
    chain ? can(viewer.ctx, "companies.manage", chain) : Promise.resolve(false),
    chain ? can(viewer.ctx, "companies.delete", chain) : Promise.resolve(false),
    company ? listDataRequests(viewer.ctx, org.id, company.id).catch(() => []) : Promise.resolve([]),
  ]);
  const base = company ? `/api/v1/organizations/${org.id}/companies/${company.id}` : "";
  const open = requests.find((r) => r.type === "DELETION" && (r.status === "PENDING" || r.status === "SCHEDULED"));
  const tz = viewer.user.timezone;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title={t("enterprise.data.exportTitle")} description={company ? t("enterprise.data.exportHint", { company: company.name }) : undefined} />
        <CardBody className="grid gap-2">
          {!company ? (
            <p className="text-sm text-muted-foreground">{t("company.empty")}</p>
          ) : canManageOrg ? (
            <div>
              <Button asChild variant="secondary">
                <a href={`${base}/enterprise/export`} download>
                  <Download aria-hidden />
                  {t("enterprise.data.download")}
                </a>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("enterprise.data.exportNeedsPermission")}</p>
          )}
          <p className="text-xs text-muted-foreground">{t("enterprise.data.exportNote")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("enterprise.data.retentionTitle")} />
        <CardBody>
          {canManageOrg ? (
            <RetentionForm
              orgId={org.id}
              initial={{
                auditRetentionDays: settings.auditRetentionDays,
                dataRetentionDays: settings.dataRetentionDays,
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("enterprise.data.auditRetention")}: {settings.auditRetentionDays ?? "∞"} · {t("enterprise.data.dataRetention")}: {settings.dataRetentionDays ?? "∞"}
            </p>
          )}
        </CardBody>
      </Card>

      {company ? (
        <Card className="border-danger/40">
          <CardHeader
            title={t("enterprise.data.deletionTitle", {
              company: company.name,
            })}
            description={t("enterprise.data.deletionHint", {
              days: DELETION_GRACE_DAYS,
            })}
          />
          <CardBody className="grid gap-3">
            {open ? (
              <div className="grid gap-2">
                <Notice tone={open.status === "SCHEDULED" ? "danger" : "warning"}>
                  {open.status === "SCHEDULED" && open.scheduledFor
                    ? t("enterprise.data.scheduled", {
                        date: formatDate(open.scheduledFor, locale, tz),
                      })
                    : canConfirm
                      ? t("enterprise.data.pendingCanConfirm")
                      : t("enterprise.data.pending")}
                </Notice>
                {canRequest || canConfirm ? <DeletionActions base={base} requestId={open.id} companyName={company.name} status={open.status} canConfirm={canConfirm} /> : null}
              </div>
            ) : canRequest ? (
              <RequestDeletion base={base} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("enterprise.data.deletionNeedsPermission")}</p>
            )}
            {requests.length ? (
              <ul className="grid gap-1 border-t pt-3 text-xs">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[r.status]}>{t(`enterprise.data.statuses.${r.status}`)}</Badge>
                    <span>{t(`enterprise.data.types.${r.type}`)}</span>
                    <span className="text-muted-foreground">{formatDateTime(r.createdAt, locale, tz)}</span>
                    {r.reason ? <span className="text-muted-foreground">— {r.reason}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
