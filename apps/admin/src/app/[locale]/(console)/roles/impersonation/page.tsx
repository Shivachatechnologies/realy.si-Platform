import Link from "next/link";
import { VenetianMask } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, NextPage, QuickFilters, guard, sp } from "@/components/admin/kit";
import { Timestamp } from "@/components/admin/timestamp";
import { EndImpersonationButton } from "@/components/admin/people/user-admin-actions";
import { getLocale, getT } from "@/i18n/server";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { IMPERSONATION_MAX_MINUTES, listImpersonations } from "@/server/modules/admin/impersonation";
import { requireViewer } from "@/server/session";

/** Every impersonation: who, whom, why, mode, duration, how it ended, requests attributed; end live ones. */
export default async function AdminImpersonationsPage({ searchParams }: PageProps<"/[locale]/roles/impersonation">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { state: sp(q.state), admin: sp(q.admin), target: sp(q.target) };
  const r = await guard(listImpersonations(viewer.ctx, { ...params, cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.security.manage"] as const);
  const base = `/${locale}/roles/impersonation`;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<VenetianMask />} title={t("admin.access.imp.title")} description={t("admin.access.imp.subtitle", { minutes: IMPERSONATION_MAX_MINUTES })} why={t("admin.access.imp.why")} />
      <Card>
        <QuickFilters
          base={base}
          name="state"
          value={params.state}
          params={params}
          label={t("admin.access.users.columns.status")}
          options={[
            { value: "", label: t("admin.common.all") },
            { value: "live", label: t("admin.access.imp.live") },
            { value: "ended", label: t("admin.access.imp.endedLabel") },
          ]}
        />
        {r.value.data.length === 0 ? (
          <EmptyState icon={<VenetianMask />} title={t("admin.access.imp.none")} />
        ) : (
          <Table density="compact">
            <THead>
              <Tr>
                <Th>{t("admin.access.imp.admin")}</Th>
                <Th>{t("admin.access.imp.target")}</Th>
                <Th>{t("admin.access.imp.mode")}</Th>
                <Th>{t("common.reason")}</Th>
                <Th>{t("admin.access.imp.started")}</Th>
                <Th>{t("admin.access.users.columns.status")}</Th>
                <Th className="text-end">{t("admin.access.imp.requests")}</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {r.value.data.map((i) => (
                <Tr key={i.id}>
                  <Td className="text-xs">{i.admin?.email ?? "—"}</Td>
                  <Td className="text-xs">
                    <Link href={`/${locale}/users/${i.targetUserId}?tab=authentication`} className="hover:underline">
                      {i.target?.email ?? i.targetUserId.slice(0, 8)}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={i.mode === "FULL" ? "danger" : "info"}>{t(`admin.access.imp.modes.${i.mode}`)}</Badge>
                  </Td>
                  <Td className="max-w-72 truncate text-xs" title={i.reason}>
                    {i.reason}
                    {i.ticketRef ? <span className="ms-1 font-mono text-muted-foreground">{i.ticketRef}</span> : null}
                  </Td>
                  <Td className="text-xs">
                    <Timestamp value={i.startedAt} />
                  </Td>
                  <Td>
                    <Badge tone={i.live ? "warning" : "neutral"}>{i.live ? t("admin.access.imp.live") : t(`admin.access.imp.endedBy.${i.endedBy ?? "expiry"}`)}</Badge>
                    {!i.redeemedAt ? <span className="ms-1 text-[11px] text-muted-foreground">{t("admin.access.imp.notOpened")}</span> : null}
                  </Td>
                  <Td className="text-end text-xs tabular-nums">{i.requestCount}</Td>
                  <Td>{i.live && (caps["platform.security.manage"] || i.adminUserId === viewer.user.id) ? <EndImpersonationButton impersonationId={i.id} own={i.adminUserId === viewer.user.id} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={r.value.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
