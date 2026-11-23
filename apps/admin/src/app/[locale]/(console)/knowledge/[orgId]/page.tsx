import Link from "next/link";
import { notFound } from "next/navigation";
import { BrainCircuit, Lock } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { KnowledgeActions, KnowledgeDocumentDelete, KnowledgeRetentionEditor } from "@/components/admin/ai/ai-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { knowledgeForOrganization } from "@/server/modules/admin/knowledge-admin";
import { requireViewer } from "@/server/session";

/** One organization's knowledge, per company: documents, index coverage, memory, retention and authorized actions. */
export default async function AdminKnowledgeOrgPage({ params, searchParams }: PageProps<"/[locale]/knowledge/[orgId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  const q = await searchParams;
  const r = await guard(
    knowledgeForOrganization(viewer.ctx, orgId, { company: sp(q.company), cursor: sp(q.cursor), status: sp(q.status) }).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const k = r.value;
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/knowledge/${orgId}`;
  const canManage = k.caps["platform.ai.manage"];
  const cov = k.coverage;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: k.organization.name }]} />
      <AdminHeader
        icon={<BrainCircuit />}
        title={k.organization.name}
        description={t("admin.knowledge.orgSubtitle")}
        actions={canManage && k.companyId ? <KnowledgeActions organizationId={orgId} organizationName={k.organization.name} companyId={k.companyId} canExport={k.caps["platform.data.export"]} /> : null}
      />
      {k.companies.length > 1 ? <QuickFilters base={base} name="company" value={k.companyId ?? ""} params={{}} label={t("admin.ai.task.company")} options={k.companies.map((c) => ({ value: c.id, label: c.name }))} /> : null}
      {!k.companyId || !cov ? (
        <EmptyState icon={<BrainCircuit />} title={t("admin.knowledge.noCompanies")} />
      ) : (
        <>
          <StatGrid>
            <StatTile label={t("admin.knowledge.chunksLabel")} value={n(cov.chunks)} hint={t("admin.knowledge.embeddedN", { count: cov.chunkEmbedded })} />
            <StatTile label={t("admin.knowledge.memories")} value={n(cov.memories)} hint={t("admin.knowledge.embeddedN", { count: cov.memoryEmbedded })} />
            <StatTile label={t("admin.knowledge.employeeMemory")} value={n(k.employeeMemory)} />
            <StatTile label={t("admin.knowledge.failed")} value={n(k.failures.length)} tone={k.failures.length ? "warning" : undefined} href={`${base}?company=${k.companyId}&status=FAILED`} />
          </StatGrid>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("admin.knowledge.index")} />
              <Facts
                rows={[
                  [t("admin.knowledge.embeddingModel"), cov.model ? <span key="m" className="font-mono text-xs">{cov.model}</span> : t("admin.knowledge.noEmbeddings")],
                  [t("admin.knowledge.lastEmbedded"), cov.lastEmbeddedAt ? <Timestamp key="l" value={cov.lastEmbeddedAt} /> : "—"],
                  [t("admin.knowledge.chunkCoverage"), cov.chunks ? `${Math.round((cov.chunkEmbedded / cov.chunks) * 100)}%` : "—"],
                  [t("admin.knowledge.memoryCoverage"), cov.memories ? `${Math.round((cov.memoryEmbedded / cov.memories) * 100)}%` : "—"],
                ]}
              />
              <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("admin.knowledge.indexHint")}</p>
            </Card>
            <Card>
              <CardHeader title={t("admin.knowledge.byLayer")} />
              {k.memoryByLayer.length === 0 ? (
                <EmptyState title={t("admin.knowledge.noMemory")} />
              ) : (
                <CardBody className="flex flex-wrap gap-2 text-xs">
                  {k.memoryByLayer.map((m) => (
                    <span key={m.layer} className="rounded border px-2 py-1">
                      {m.layer} <span className="tabular-nums text-muted-foreground">{n(m.count)}</span>
                    </span>
                  ))}
                </CardBody>
              )}
            </Card>
          </div>
          <Card>
            <CardHeader title={t("admin.knowledge.retention")} description={t("admin.knowledge.retentionCardHint")} />
            <Table>
              <TBody>
                {k.retention.map((x) => (
                  <Tr key={x.layer}>
                    <Td className="font-mono text-xs">{x.layer}</Td>
                    <Td className="text-xs">{x.retentionDays === null ? (x.custom ? t("admin.knowledge.keepForever") : t("admin.knowledge.moduleDefault")) : t("admin.knowledge.days", { count: x.retentionDays })}</Td>
                    <Td className="text-xs text-muted-foreground">{x.updatedAt ? <Timestamp value={x.updatedAt} mode="relative" /> : null}</Td>
                    <Td className="text-end">{canManage ? <KnowledgeRetentionEditor organizationId={orgId} companyId={k.companyId!} layer={x.layer} retentionDays={x.retentionDays} /> : null}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title={t("admin.knowledge.documents")} description={k.sensitive ? undefined : t("admin.knowledge.titlesHidden")} />
            <QuickFilters base={base} name="status" value={sp(q.status)} params={{ company: k.companyId }} label={t("admin.ai.columns.status")} options={[{ value: "", label: t("admin.common.all") }, ...(["READY", "PROCESSING", "FAILED"] as const).map((s) => ({ value: s, label: t(`admin.knowledge.docStatus.${s}`) }))]} />
            {k.documents.length === 0 ? (
              <EmptyState title={t("admin.knowledge.noDocuments")} />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.knowledge.document")}</Th>
                    <Th>{t("admin.ai.columns.status")}</Th>
                    <Th>{t("admin.knowledge.size")}</Th>
                    <Th>{t("admin.knowledge.chunksLabel")}</Th>
                    <Th>{t("admin.knowledge.source")}</Th>
                    <Th>{t("admin.workflows.updated")}</Th>
                    {canManage ? <Th className="text-end">{t("admin.common.actions")}</Th> : null}
                  </Tr>
                </THead>
                <TBody>
                  {k.documents.map((d) => (
                    <Tr key={d.id}>
                      <Td className="max-w-72 truncate text-sm">
                        {d.title ?? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Lock className="size-3" />
                            <span className="font-mono text-xs">{d.id.slice(0, 8)}</span>
                          </span>
                        )}
                        <div className="font-mono text-[11px] text-muted-foreground">{d.mimeType}</div>
                      </Td>
                      <Td>
                        <StatusBadge domain="brainDocument" value={d.status}>{t(`admin.knowledge.docStatus.${d.status}`)}</StatusBadge>
                      </Td>
                      <Td className="text-xs tabular-nums">{n(Math.round(d.sizeBytes / 1024))} KB</Td>
                      <Td className="text-xs tabular-nums">{n(d.chunks)}</Td>
                      <Td className="text-xs">{d.sourceType ?? t("admin.knowledge.upload")}</Td>
                      <Td className="text-xs">
                        <Timestamp value={d.updatedAt} mode="relative" />
                      </Td>
                      {canManage ? <Td className="text-end">{d.sourceType ? null : <KnowledgeDocumentDelete organizationId={orgId} companyId={k.companyId!} documentId={d.id} />}</Td> : null}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
            {k.nextCursor ? (
              <div className="flex justify-end border-t p-3">
                <Link className="text-xs font-medium text-primary hover:underline" href={`${base}?company=${k.companyId}${sp(q.status) ? `&status=${sp(q.status)}` : ""}&cursor=${k.nextCursor}`}>
                  {t("common.next")}
                </Link>
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
