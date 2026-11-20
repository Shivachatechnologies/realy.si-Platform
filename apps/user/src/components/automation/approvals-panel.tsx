import "server-only";
import Link from "next/link";
import { ApprovalDecision } from "@/components/automation/workflow-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { AppLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import type { RequestContext } from "@/server/core/context";
import { listMyWorkflowApprovals } from "@/server/modules/automation/service";

/**
 * Workflow approval gates waiting for the viewer, for the main /approvals page:
 *   <WorkflowApprovalsPanel ctx={viewer.ctx} locale={locale} organizationId={org.id} companyId={company.id} timezone={company.timezone} />
 * Renders nothing when no workflow approval is waiting for the viewer.
 */
export async function WorkflowApprovalsPanel({ ctx, locale, organizationId, companyId, timezone }: { ctx: RequestContext; locale: AppLocale; organizationId: string; companyId: string; timezone?: string | null }) {
  const rows = await listMyWorkflowApprovals(ctx, organizationId, companyId);
  if (!rows.length) return null;
  const t = await getT(locale);
  const tz = timezone ?? "UTC";
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}`;
  return (
    <Card>
      <CardHeader
        title={t("workflows.approvals.panelTitle", { count: rows.length })}
        description={t("workflows.approvals.panelHelp")}
        actions={
          <Link href={`/${locale}/workflows/approvals`} className="text-sm text-primary hover:underline">
            {t("workflows.viewAll")}
          </Link>
        }
      />
      <ul className="divide-y">
        {rows.map((a) => (
          <li key={a.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.title}</span>
                <Badge tone="warning">{t("workflows.approvals.status.PENDING")}</Badge>
              </div>
              {a.message ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.message}</p> : null}
              <p className="text-xs text-muted-foreground">
                {a.run.workflow.name} · {formatDateTime(a.createdAt, locale, tz)}
                {a.expiresAt ? ` · ${t("workflows.approvals.expires", { date: formatDateTime(a.expiresAt, locale, tz) })}` : ""}
              </p>
            </div>
            <ApprovalDecision base={base} approvalId={a.id} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
