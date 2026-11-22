import Link from "next/link";
import { ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, guard } from "@/components/admin/kit";
import { Timestamp } from "@/components/admin/timestamp";
import { CreateReviewButton } from "@/components/admin/people/access-admin-actions";
import { getLocale, getT } from "@/i18n/server";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { listAccessReviews } from "@/server/modules/admin/access-reviews";
import { requireViewer } from "@/server/session";

const STATUS_TONE = { OPEN: "info", COMPLETED: "success", CANCELED: "neutral" } as const;

/** Platform access reviews: KEEP / REVOKE every platform grant; REVOKE applies immediately. */
export default async function AdminAccessReviewsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(listAccessReviews(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.roles.manage", "platform.security.manage"] as const);
  const canManage = caps["platform.roles.manage"] || caps["platform.security.manage"];
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<ListChecks />} title={t("admin.access.reviews.titlePage")} description={t("admin.access.reviews.subtitle")} actions={canManage ? <CreateReviewButton locale={locale} /> : null} />
      <Card>
        {r.value.length === 0 ? (
          <EmptyState icon={<ListChecks />} title={t("admin.access.reviews.empty")} body={t("admin.access.reviews.emptyHint")} />
        ) : (
          <Table density="compact">
            <THead>
              <Tr>
                <Th>{t("admin.access.reviews.title")}</Th>
                <Th>{t("admin.access.users.columns.status")}</Th>
                <Th className="text-end">{t("admin.access.reviews.progress")}</Th>
                <Th>{t("admin.access.reviews.due")}</Th>
                <Th>{t("admin.access.users.columns.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {r.value.map((rv) => (
                <Tr key={rv.id}>
                  <Td>
                    <Link href={`/${locale}/roles/reviews/${rv.id}`} className="font-medium hover:underline">
                      {rv.title}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">{rv.createdBy ?? "—"}</div>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[rv.status]}>{t(`admin.access.reviews.status.${rv.status}`)}</Badge>
                  </Td>
                  <Td className="text-end text-xs tabular-nums">{t("admin.access.reviews.counts", { kept: rv.kept, revoked: rv.revoked, pending: rv.pending })}</Td>
                  <Td className="text-xs">{rv.dueAt ? <Timestamp value={rv.dueAt} mode="absolute" /> : "—"}</Td>
                  <Td className="text-xs">
                    <Timestamp value={rv.createdAt} mode="absolute" />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
