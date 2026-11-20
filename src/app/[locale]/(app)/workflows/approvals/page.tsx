import type { Metadata } from "next";
import Link from "next/link";
import { workflowsPage } from "@/components/automation/frame";
import { ApprovalDecision } from "@/components/automation/workflow-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listWorkflowApprovals } from "@/server/modules/automation/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workflows.tabs.approvals") };
}

export default async function WorkflowApprovalsPage({ searchParams }: PageProps<"/[locale]/workflows/approvals">) {
  const p = await workflowsPage("approvals");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, canExecute, tz, base } = p.ctx;
  const decided = (await searchParams).view === "decided";
  const rows = await listWorkflowApprovals(viewer.ctx, org.id, company.id, decided ? "DECIDED" : "PENDING");
  const userIds = [...new Set(rows.flatMap((r) => [...r.approverIds, ...(r.decidedById ? [r.decidedById] : [])]))];
  const users = userIds.length ? await db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  const me = viewer.user.id;
  return p.render(
    <Card>
      <CardHeader
        title={decided ? t("workflows.approvals.decided") : t("workflows.approvals.pending")}
        description={t("workflows.approvals.help")}
        actions={
          <Link href={`/${locale}/workflows/approvals${decided ? "" : "?view=decided"}`} className="text-sm text-primary hover:underline">
            {decided ? t("workflows.approvals.showPending") : t("workflows.approvals.showDecided")}
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="p-4 text-muted-foreground">{decided ? t("workflows.approvals.noneDecided") : t("workflows.approvals.empty")}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((a) => {
            const mayDecide = canExecute && a.status === "PENDING" && (!a.approverIds.length || a.approverIds.includes(me));
            return (
              <li key={a.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    <Badge tone={a.status === "APPROVED" ? "success" : a.status === "PENDING" ? "warning" : "danger"}>{t(`workflows.approvals.status.${a.status}`)}</Badge>
                  </div>
                  {a.message ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.message}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    <Link href={`/${locale}/workflows/runs/${a.run.id}`} className="hover:underline">
                      {a.run.workflow.name}
                    </Link>{" "}
                    · {formatDateTime(a.createdAt, locale, tz)}
                    {a.approverIds.length ? ` · ${t("workflows.approvals.approvers", { names: a.approverIds.map((id) => name.get(id) ?? "?").join(", ") })}` : ""}
                  </p>
                  {a.decidedById ? (
                    <p className="text-xs text-muted-foreground">
                      {t("workflows.approvals.decidedBy", { name: name.get(a.decidedById) ?? "—", date: a.decidedAt ? formatDateTime(a.decidedAt, locale, tz) : "" })}
                      {a.note ? ` — “${a.note}”` : ""}
                    </p>
                  ) : null}
                </div>
                {mayDecide ? <ApprovalDecision base={base} approvalId={a.id} /> : a.status === "PENDING" ? <p className="text-xs text-muted-foreground">{t("workflows.approvals.notYours")}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>,
  );
}
