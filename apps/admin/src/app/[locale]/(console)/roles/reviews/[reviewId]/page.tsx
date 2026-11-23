import Link from "next/link";
import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { Timestamp } from "@/components/admin/timestamp";
import { CloseReviewButton, DecideItem } from "@/components/admin/people/access-admin-actions";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { getAccessReview } from "@/server/modules/admin/access-reviews";
import { requestTime, requireViewer } from "@/server/session";

/** One access review: every platform grant at creation, decisions, and the completion report. */
export default async function AdminAccessReviewPage({ params }: PageProps<"/[locale]/roles/reviews/[reviewId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { reviewId } = await params;
  const r = await guard(
    getAccessReview(viewer.ctx, reviewId).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const rv = r.value;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.roles.manage", "platform.security.manage"] as const);
  const canManage = (caps["platform.roles.manage"] || caps["platform.security.manage"]) && rv.status === "OPEN";
  const pending = rv.items.filter((i) => !i.decision).length;
  const kept = rv.items.filter((i) => i.decision === "KEEP").length;
  const revoked = rv.items.filter((i) => i.decision === "REVOKE").length;
  return (
    <div className="grid gap-4">
      <nav aria-label={t("admin.common.breadcrumb")} className="text-xs text-muted-foreground">
        <Link href={`/${locale}/roles/reviews`} className="hover:text-foreground hover:underline">
          {t("admin.access.reviews.titlePage")}
        </Link>
        <span aria-hidden> / </span>
        <span>{rv.title}</span>
      </nav>
      <AdminHeader
        icon={<ListChecks />}
        title={rv.title}
        description={t("admin.access.reviews.createdBy", { name: rv.createdBy?.name ?? "—" })}
        meta={<Badge tone={rv.status === "OPEN" ? "info" : rv.status === "COMPLETED" ? "success" : "neutral"}>{t(`admin.access.reviews.status.${rv.status}`)}</Badge>}
        actions={
          canManage ? (
            <>
              <CloseReviewButton reviewId={rv.id} action="complete" disabled={pending > 0} />
              <CloseReviewButton reviewId={rv.id} action="cancel" />
            </>
          ) : null
        }
      />
      <StatGrid>
        <StatTile label={t("admin.access.reviews.items")} value={rv.items.length} />
        <StatTile label={t("admin.access.reviews.pending")} value={pending} tone={pending ? "warning" : "success"} />
        <StatTile label={t("admin.access.reviews.kept")} value={kept} />
        <StatTile label={t("admin.access.reviews.revoked")} value={revoked} tone={revoked ? "danger" : undefined} />
      </StatGrid>
      {rv.status === "OPEN" && rv.dueAt && rv.dueAt.getTime() < requestTime() ? <Notice tone="warning">{t("admin.access.reviews.overdue")}</Notice> : null}
      <Card>
        <CardHeader title={t("admin.access.reviews.items")} description={t("admin.access.reviews.itemsHint")} />
        <Table density="compact">
          <THead>
            <Tr>
              <Th>{t("admin.access.users.columns.user")}</Th>
              <Th>{t("admin.users.role")}</Th>
              <Th>{t("admin.access.reviews.lastSeen")}</Th>
              <Th>{t("admin.access.reviews.grant")}</Th>
              <Th>{t("admin.access.reviews.decision")}</Th>
            </Tr>
          </THead>
          <TBody>
            {rv.items.map((i) => (
              <Tr key={i.id}>
                <Td>
                  <Link href={`/${locale}/users/${i.principalId}`} className="font-medium hover:underline">
                    {i.user?.name ?? i.principalId.slice(0, 8)}
                  </Link>
                  <div className="flex gap-1 text-[11px] text-muted-foreground">
                    {i.user?.email}
                    {i.user && !i.user.mfaEnabled ? <Badge tone="danger">{t("admin.roles.noMfa")}</Badge> : null}
                  </div>
                </Td>
                <Td>
                  <Badge tone="accent" className="font-mono">
                    {i.roleKey}
                  </Badge>
                  {i.scope !== "PLATFORM" ? <span className="ms-1 font-mono text-[11px]">{i.scope}</span> : null}
                </Td>
                <Td className="text-xs">{i.lastSeenAt ? <Timestamp value={i.lastSeenAt} mode="relative" /> : t("admin.users.login.never")}</Td>
                <Td className="text-xs">{i.stillGranted ? (i.expiresAt ? <Timestamp value={i.expiresAt} mode="relative" /> : t("admin.access.reviews.active")) : t("admin.access.reviews.gone")}</Td>
                <Td>
                  {i.decision ? (
                    <span className="grid gap-0.5 text-xs">
                      <Badge tone={i.decision === "KEEP" ? "success" : "danger"}>{t(`admin.access.reviews.${i.decision === "KEEP" ? "keep" : "revoke"}`)}</Badge>
                      <span className="text-muted-foreground">
                        {i.decidedBy?.name ?? "—"} · {i.decidedAt ? <Timestamp value={i.decidedAt} mode="relative" /> : null}
                      </span>
                      {i.note ? <span className="text-muted-foreground">“{i.note}”</span> : null}
                    </span>
                  ) : canManage && i.principalId !== viewer.user.id ? (
                    <DecideItem reviewId={rv.id} itemId={i.id} who={i.user?.email ?? i.principalId} />
                  ) : (
                    <span className="text-xs text-muted-foreground">{i.principalId === viewer.user.id ? t("admin.access.reviews.selfReview") : t("admin.access.reviews.pending")}</span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
