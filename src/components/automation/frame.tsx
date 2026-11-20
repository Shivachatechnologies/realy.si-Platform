import "server-only";
import type { ReactNode } from "react";
import { WorkflowsTabs, type WorkflowsTab } from "@/components/automation/tabs";
import { Forbidden, NoCompany, PageFrame } from "@/components/automation/page-frame";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

/** Shared context of a Workflows page: header + tabs, "no company" and "forbidden" states, viewer capabilities. */
export async function workflowsPage(tab: WorkflowsTab | null, opts: { title?: string; subtitle?: string; actions?: ReactNode } = {}) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const pending = company ? await db().workflowApprovalRequest.count({ where: { organizationId: org.id, companyId: company.id, status: "PENDING" } }).catch(() => 0) : 0;
  const wrap = (children: ReactNode, withTabs = true, actions?: ReactNode) => (
    <PageFrame title={opts.title ?? t("modules.workflows.title")} subtitle={opts.subtitle ?? (opts.title ? undefined : t("workflows.subtitle"))} actions={actions ?? opts.actions}>
      {withTabs && tab ? (
        <WorkflowsTabs
          locale={locale}
          active={tab}
          pending={pending}
          labels={{ workflows: t("workflows.tabs.workflows"), runs: t("workflows.tabs.runs"), approvals: t("workflows.tabs.approvals"), templates: t("workflows.tabs.templates") }}
        />
      ) : null}
      {children}
    </PageFrame>
  );
  if (!company) return { page: wrap(<NoCompany message={t("company.empty")} />, false) } as const;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canExecute] = await Promise.all([can(viewer.ctx, "workflows.read", chain), can(viewer.ctx, "workflows.manage", chain), can(viewer.ctx, "workflows.execute", chain)]);
  if (!canRead) return { page: wrap(<Forbidden message={t("errors.forbidden")} />, false) } as const;
  return {
    page: null,
    ctx: { locale, t, viewer, org, company, chain, canManage, canExecute, tz: company.timezone ?? "UTC", base: `/api/v1/organizations/${org.id}/companies/${company.id}` },
    render: wrap,
  } as const;
}

export const RUN_TONE = { QUEUED: "neutral", RUNNING: "accent", WAITING: "warning", SUCCEEDED: "success", FAILED: "danger", CANCELLED: "neutral" } as const;
export const WORKFLOW_TONE = { DRAFT: "neutral", ACTIVE: "success", PAUSED: "warning", ARCHIVED: "neutral" } as const;
