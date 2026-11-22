import Link from "next/link";
import { BrainCircuit, Database, FileText, MemoryStick } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { knowledgeOverview } from "@/server/modules/admin/knowledge-admin";
import { requireViewer } from "@/server/session";

const bytes = (v: number, locale: string) => {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${formatNumber(Math.round(x * 10) / 10, locale)} ${u[i]}`;
};

/** Knowledge & memory across organizations: storage, index coverage, memory, ingestion jobs, retrieval activity. */
export default async function AdminKnowledgePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(knowledgeOverview(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const k = r.value;
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/knowledge`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<BrainCircuit />}
        title={t("admin.knowledge.title")}
        description={t("admin.knowledge.subtitle")}
        why={t("admin.knowledge.why")}
        meta={
          <span className="text-[11px] text-muted-foreground">
            {t("admin.knowledge.cached")} · <Timestamp value={k.computedAt} mode="relative" />
          </span>
        }
      />
      {!k.vectorExtension ? <Notice tone="warning" title={t("admin.knowledge.noVector")}>{t("admin.knowledge.noVectorBody")}</Notice> : null}
      <StatGrid>
        <StatTile icon={<FileText />} label={t("admin.knowledge.documents")} value={n(k.totals.documents)} hint={t("admin.knowledge.failedDocs", { count: k.totals.failedDocuments })} tone={k.totals.failedDocuments ? "warning" : undefined} />
        <StatTile icon={<Database />} label={t("admin.knowledge.storage")} value={bytes(k.totals.documentBytes, locale)} hint={t("admin.knowledge.chunks", { count: k.totals.chunks })} />
        <StatTile icon={<BrainCircuit />} label={t("admin.knowledge.embeddings")} value={n(k.totals.embeddings)} hint={k.totals.chunks + k.totals.memories ? t("admin.knowledge.coverage", { pct: Math.round((k.totals.embeddings / Math.max(1, k.totals.chunks + k.totals.memories)) * 100) }) : undefined} />
        <StatTile icon={<MemoryStick />} label={t("admin.knowledge.memories")} value={n(k.totals.memories + k.totals.employeeMemories)} hint={t("admin.knowledge.retrieved7d", { count: k.totals.retrieved7d })} />
      </StatGrid>
      <Card>
        <CardHeader title={t("admin.knowledge.perOrg")} description={t("admin.knowledge.perOrgHint")} />
        {k.perOrg.length === 0 ? (
          <EmptyState icon={<BrainCircuit />} title={t("admin.knowledge.empty")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.knowledge.documents")}</Th>
                <Th>{t("admin.knowledge.storage")}</Th>
                <Th>{t("admin.knowledge.embeddings")}</Th>
                <Th>{t("admin.knowledge.memories")}</Th>
                <Th>{t("admin.knowledge.retrievedShort")}</Th>
              </Tr>
            </THead>
            <TBody>
              {k.perOrg.map((o) => (
                <Tr key={o.organizationId}>
                  <Td>
                    <Link href={`${base}/${o.organizationId}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                  </Td>
                  <Td className="text-xs tabular-nums">
                    {n(o.documents)}
                    {o.failedDocuments ? <span className="text-danger"> · {t("admin.knowledge.failedDocs", { count: o.failedDocuments })}</span> : null}
                  </Td>
                  <Td className="text-xs tabular-nums">{bytes(o.documentBytes + o.textBytes, locale)}</Td>
                  <Td className="text-xs tabular-nums">
                    {n(o.embeddings)} / {n(o.chunks + o.memories)}
                  </Td>
                  <Td className="text-xs tabular-nums">
                    {n(o.memories)} · {t("admin.knowledge.employeeShort", { count: o.employeeMemories })}
                  </Td>
                  <Td className="text-xs tabular-nums">{n(o.retrieved7d)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.knowledge.jobs")} description={t("admin.knowledge.jobsHint")} />
        {k.jobs.length === 0 ? (
          <EmptyState title={t("admin.knowledge.noJobs")} body={t("admin.knowledge.noJobsHint")} />
        ) : (
          <Table>
            <TBody>
              {k.jobs.map((j) => (
                <Tr key={j.id}>
                  <Td className="font-mono text-xs">
                    <Link className="hover:underline" href={`/${locale}/system/jobs?run=${j.id}`}>
                      {j.jobName}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge domain="workflowRun" value={j.status === "SUCCEEDED" ? "SUCCEEDED" : j.status === "FAILED" || j.status === "DEAD" ? "FAILED" : "RUNNING"}>{j.status}</StatusBadge>
                    {j.lastError ? <div className="max-w-80 truncate text-[11px] text-danger">{j.lastError}</div> : null}
                  </Td>
                  <Td className="text-xs tabular-nums">{j.result ?? "—"}</Td>
                  <Td className="text-xs">{j.finishedAt ? <Timestamp value={j.finishedAt} mode="relative" /> : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
