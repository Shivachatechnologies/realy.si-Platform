import Link from "next/link";
import { Download, FileWarning, HardDrive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SourceNote, bytes, qs } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { DELETE_PHRASE, FILE_STORES, LARGE_FILE_BYTES, listDeletionRequests, listFiles, storageOverview } from "@/server/modules/admin/files-admin";
import { requireViewer } from "@/server/session";

/** Files & storage explorer: records across file stores (metadata only), per-org bytes, orphans, two-person deletion. */
export default async function FilesPage({ searchParams }: PageProps<"/[locale]/files">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { store: sp(q.store), org: sp(q.org), large: sp(q.large), q: sp(q.q) };
  const r = await guard(
    Promise.all([storageOverview(viewer.ctx), listFiles(viewer.ctx, { ...params, cursor: sp(q.cursor) }), listDeletionRequests(viewer.ctx, { status: "PENDING" }), capabilitiesFor(viewer.ctx, ["platform.security.manage", "platform.content.manage", "platform.data.export"])]),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const [o, files, pending, caps] = r.value;
  const canRequest = caps["platform.security.manage"] || caps["platform.content.manage"];
  const canApprove = caps["platform.security.manage"];
  const canExport = caps["platform.data.export"] || caps["platform.security.manage"];
  const base = `/${locale}/files`;
  const store = files.filters.store;
  const totalBytes = o.stores.reduce((n, s) => n + s.bytes, 0);
  const totalFiles = o.stores.reduce((n, s) => n + s.files, 0);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<HardDrive />}
        title={t("admin.files.title")}
        description={t("admin.files.subtitle")}
        why={t("admin.files.why")}
        actions={
          canExport ? (
            <Button asChild size="sm" variant="secondary">
              <a href={`/api/v1/admin/files/export${qs({ ...params, store })}`} download>
                <Download aria-hidden />
                {t("admin.files.exportMetadata")}
              </a>
            </Button>
          ) : null
        }
        meta={<SourceNote source="integration_stored_objects · cms_media · visual_assets · creative_assets · file_deletion_requests" at={new Date()} label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} />}
      />
      <StatGrid>
        <StatTile icon={<HardDrive />} label={t("admin.files.totalBytes")} value={bytes(totalBytes, locale)} hint={t("admin.files.totalFiles", { count: totalFiles })} />
        <StatTile icon={<FileWarning />} label={t("admin.files.orphans")} value={formatNumber(o.orphans.cmsMediaWithoutOrganization + o.orphans.creativeWithoutFile, locale)} hint={t("admin.files.orphansHint", { cms: o.orphans.cmsMediaWithoutOrganization, creative: o.orphans.creativeWithoutFile })} />
        <StatTile label={t("admin.files.large")} value={`≥ ${bytes(LARGE_FILE_BYTES, locale)}`} hint={t("admin.files.largeHint")} href={`${base}${qs({ ...params, large: "1" })}`} />
        <StatTile icon={<Trash2 />} label={t("admin.files.pendingDeletes")} value={o.pendingDeletes} tone={o.pendingDeletes ? "warning" : undefined} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.files.stores")} />
          <ul className="divide-y text-sm">
            {o.stores.map((s) => (
              <li key={s.store} className="flex items-center justify-between gap-2 px-4 py-2">
                <Link href={`${base}?store=${s.store}`} className="hover:underline">{t(`admin.files.storeNames.${s.store}`)}</Link>
                <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(s.files, locale)} · {bytes(s.bytes, locale)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={t("admin.files.byOrg")} description={t("admin.files.byOrgHint")} />
          {o.byOrganization.length ? (
            <ul className="divide-y text-sm">
              {o.byOrganization.map((b) => (
                <li key={b.organizationId} className="flex items-center justify-between gap-2 px-4 py-2">
                  <Link href={`${base}?store=${store}&org=${b.organizationId}`} className="truncate hover:underline">{b.organizationName ?? t("admin.files.deletedOrg")}</Link>
                  <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(b.files, locale)} · {bytes(b.bytes, locale)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noData")}</p>
          )}
        </Card>
      </div>
      {pending.length ? (
        <Card>
          <CardHeader icon={<Trash2 />} title={t("admin.files.deletionRequests")} description={t("admin.files.deletionRequestsHint")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.files.file")}</Th>
                <Th>{t("admin.files.requestedBy")}</Th>
                <Th>{t("admin.files.reason")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {pending.map((p) => {
                const meta = (p.fileMeta ?? {}) as { name?: string; size?: number };
                const mine = p.requestedById === viewer.user.id;
                return (
                  <Tr key={p.id}>
                    <Td className="text-xs">
                      <span className="font-medium">{meta.name ?? p.fileId.slice(0, 8)}</span>
                      <div className="text-[11px] text-muted-foreground">{t(`admin.files.storeNames.${p.store}`)} · {bytes(meta.size ?? null, locale)}</div>
                    </Td>
                    <Td className="text-xs">{p.requestedBy?.name ?? "—"}<div className="text-[11px] text-muted-foreground"><Timestamp value={p.createdAt} mode="relative" /></div></Td>
                    <Td className="max-w-xs text-xs">{p.reason}</Td>
                    <Td className="text-end">
                      <div className="inline-flex gap-1">
                        {canApprove && !mine ? <ActionButton label={t("admin.files.approve")} title={t("admin.files.approveTitle", { name: meta.name ?? "" })} description={t("admin.files.approveHint")} path={`/api/v1/admin/files/deletions/${p.id}`} method="POST" body={{ decision: "approve" }} phrase={DELETE_PHRASE} danger /> : null}
                        {canApprove && !mine ? <ActionButton label={t("admin.files.reject")} title={t("admin.files.rejectTitle")} path={`/api/v1/admin/files/deletions/${p.id}`} method="POST" body={{ decision: "reject" }} variant="ghost" /> : null}
                        {mine ? <ActionButton label={t("admin.files.cancel")} title={t("admin.files.cancelTitle")} path={`/api/v1/admin/files/deletions/${p.id}`} method="POST" body={{ decision: "cancel" }} variant="ghost" /> : null}
                        {mine ? <span className="self-center text-[11px] text-muted-foreground">{t("admin.files.awaitingOther")}</span> : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : null}
      <Card>
        <QuickFilters base={base} name="store" value={store} params={{ org: params.org, large: params.large }} label={t("admin.files.stores")} options={FILE_STORES.map((s) => ({ value: s, label: t(`admin.files.storeNames.${s}`) }))} />
        <FilterBar
          action={base}
          values={params}
          submitLabel={t("admin.settings.kit.apply")}
          filters={[]}
          extra={
            <>
              <input type="hidden" name="store" value={store} />
              {params.org ? <input type="hidden" name="org" value={params.org} /> : null}
              <Input name="q" defaultValue={params.q} placeholder={t("admin.files.searchName")} aria-label={t("admin.files.searchName")} className="w-56" maxLength={120} />
              <label className="flex items-center gap-1.5 self-center text-xs">
                <input type="checkbox" name="large" value="1" defaultChecked={!!params.large} />
                {t("admin.files.largeOnly")}
              </label>
              {params.org || params.large || params.q ? (
                <Link href={`${base}?store=${store}`} className="self-center text-xs text-primary hover:underline">{t("admin.common.clearFilters")}</Link>
              ) : null}
            </>
          }
        />
        {files.data.length === 0 ? (
          <EmptyState icon={<HardDrive />} title={t("admin.files.empty")} body={t("admin.common.tryOtherFilters")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.files.file")}</Th>
                <Th>{t("admin.files.type")}</Th>
                <Th>{t("admin.files.size")}</Th>
                <Th>{t("admin.files.status")}</Th>
                <Th>{t("admin.files.provider")}</Th>
                <Th>{t("admin.settings.kit.organization")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {files.data.map((f) => (
                <Tr key={f.id}>
                  <Td className="max-w-xs text-xs"><span className="block truncate font-medium">{f.name}</span><span className="text-[11px] text-muted-foreground"><Timestamp value={f.createdAt} mode="relative" /></span></Td>
                  <Td className="font-mono text-[11px]">{f.contentType ?? "—"}</Td>
                  <Td className="text-xs tabular-nums">{bytes(f.size, locale)}</Td>
                  <Td><StatusBadge domain="fileStatus" value={f.status}>{t(`admin.files.statuses.${f.status}`)}</StatusBadge></Td>
                  <Td className="text-xs">{f.provider ?? "—"}{f.storage ? <span className="ms-1 font-mono text-[10px] text-muted-foreground">{f.storage}</span> : null}</Td>
                  <Td className="text-xs">{f.organizationName ? <Link href={`${base}?store=${store}&org=${f.organizationId}`} className="hover:underline">{f.organizationName}</Link> : t("admin.files.deletedOrg")}</Td>
                  <Td className="text-end">
                    {f.pendingDeletionId ? (
                      <span className="text-[11px] text-warning">{t("admin.files.deletionPending")}</span>
                    ) : canRequest && f.status !== "archived" ? (
                      <ActionButton label={t("admin.files.requestDelete")} title={t("admin.files.requestDeleteTitle", { name: f.name })} description={t("admin.files.requestDeleteHint")} path="/api/v1/admin/files/deletions" method="POST" body={{ store, fileId: f.id }} variant="ghost" />
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={{ ...params, store }} cursor={files.nextCursor} label={t("common.next")} />
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("admin.files.reprocessNote")}</p>
      </Card>
    </div>
  );
}
