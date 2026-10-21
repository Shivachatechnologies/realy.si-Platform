import type { Metadata } from "next";
import { ApprovalList } from "@/components/approvals/approval-list";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { listApprovals } from "@/server/modules/approvals/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.approvals.title") };
}

export default async function ApprovalsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{t("modules.approvals.title")}</h1>
      <p className="text-muted-foreground">{t("approvals.subtitle")}</p>
    </div>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canDecide] = await Promise.all([can(viewer.ctx, "approvals.read", chain), can(viewer.ctx, "approvals.decide", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const all = await listApprovals(viewer.ctx, org.id, company.id);
  const now = new Date();
  const pending = all.filter((a) => a.status === "PENDING" && a.expiresAt > now);
  const history = all.filter((a) => !pending.includes(a));
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const common = { t, locale, timeZone: viewer.user.timezone, apiBase, canDecide };
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <Card>
        <CardHeader title={t("approvals.pending")} description={t("approvals.count", { count: pending.length })} />
        {pending.length ? <ApprovalList approvals={pending} {...common} /> : <p className="p-4 text-muted-foreground">{t("approvals.nonePending")}</p>}
      </Card>
      {history.length ? (
        <Card>
          <CardHeader title={t("approvals.history")} />
          <ApprovalList approvals={history} {...common} />
        </Card>
      ) : null}
    </div>
  );
}
