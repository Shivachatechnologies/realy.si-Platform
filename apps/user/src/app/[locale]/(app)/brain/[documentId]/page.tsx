import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { DeleteDocumentButton } from "@/components/brain/delete-document-button";
import { DocumentLinks } from "@/components/brain/document-links";
import { DocumentMetaForm } from "@/components/brain/document-meta-form";
import { DocumentPolicyForm } from "@/components/brain/document-policy-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { documentCitations } from "@/server/modules/brain/citations";
import { listDocumentLinks, type LinkSubjectType } from "@/server/modules/brain/links";
import { getDocument, listDepartments } from "@/server/modules/brain/service";
import { READ_PERMISSIONS } from "@/server/modules/brain/memory-policy";
import { getDocumentPolicy } from "@/server/modules/brain/memory-store";
import { sourceHref } from "@/server/modules/brain/sources";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.brain.title") };
}

const SUBJECT_PERMISSIONS: [LinkSubjectType, string][] = [
  ["graph_entity", "graph.read"],
  ["account", "sales.read"],
  ["contact", "sales.read"],
  ["project", "projects.read"],
];

export default async function BrainDocumentPage({ params }: PageProps<"/[locale]/brain/[documentId]">) {
  const { documentId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const doc = await getDocument(viewer.ctx, org.id, company.id, documentId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const chain = await companyChain(db(), org.id, company.id);
  const [canManage, links, citedIn, departments, linkable] = await Promise.all([
    can(viewer.ctx, "brain.manage", chain),
    listDocumentLinks(viewer.ctx, org.id, company.id, doc.id),
    documentCitations(viewer.ctx, org.id, company.id, doc.id),
    listDepartments(viewer.ctx, org.id, company.id),
    Promise.all(SUBJECT_PERMISSIONS.map(async ([type, p]) => ((await can(viewer.ctx, p, chain)) ? type : null))),
  ]);
  // Governance (layer, sensitivity, access, owner, expiry) — editable by Company Brain managers.
  const scope = { organizationId: org.id, companyId: company.id };
  const [policy, employees, accounts] = await Promise.all([
    canManage ? getDocumentPolicy(viewer.ctx, org.id, company.id, doc.id) : null,
    canManage ? db().aiEmployee.findMany({ where: scope, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }) : [],
    canManage && linkable.includes("account") ? db().account.findMany({ where: { ...scope, archivedAt: null }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true } }) : [],
  ]);
  const tz = viewer.user.timezone;
  const origin = sourceHref(doc.sourceType, doc.sourceId);

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <Link href={`/${locale}/documents`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("modules.documents.title")}
      </Link>
      <Card>
        <CardHeader
          title={doc.title}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {doc.filename ? <span>{doc.filename}</span> : null}
              <Badge>{doc.mimeType}</Badge>
              {doc.department ? <Badge>{doc.department.name}</Badge> : null}
              {doc.tags.map((tag) => (
                <Link key={tag} className="hover:underline" href={`/${locale}/documents?tag=${encodeURIComponent(tag)}`}>
                  #{tag}
                </Link>
              ))}
              <span>{t("brain.passageCount", { count: doc.passages.length })}</span>
              <span>{formatDate(doc.createdAt, locale, tz)}</span>
            </span>
          }
          actions={canManage && !doc.sourceType ? <DeleteDocumentButton organizationId={org.id} companyId={company.id} documentId={doc.id} /> : null}
        />
        {doc.sourceType ? (
          <CardBody className="flex flex-wrap items-center gap-2 border-b text-sm">
            <Badge tone="accent">{t(`brain.sources.${doc.sourceType}`)}</Badge>
            <span className="text-muted-foreground">
              {t("brain.indexedFrom", { date: doc.sourceUpdatedAt ? formatDateTime(doc.sourceUpdatedAt, locale, tz) : "—" })}
            </span>
            {origin ? (
              <Link className="ms-auto flex items-center gap-1 hover:underline" href={`/${locale}${origin}`}>
                {t("brain.openSource")}
                <ExternalLink aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </CardBody>
        ) : null}
        {canManage ? (
          <CardBody className="border-b">
            <DocumentMetaForm
              organizationId={org.id}
              companyId={company.id}
              document={{ id: doc.id, title: doc.title, departmentId: doc.departmentId, tags: doc.tags, sourceType: doc.sourceType }}
              departments={departments}
            />
          </CardBody>
        ) : null}
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title={t("brain.memory.documentGovernance")} description={t("brain.memory.documentGovernanceHint")} />
          <CardBody>
            <DocumentPolicyForm
              organizationId={org.id}
              companyId={company.id}
              documentId={doc.id}
              policy={policy ? { ...policy, expiresOn: policy.expiresAt ? policy.expiresAt.toISOString().slice(0, 10) : null } : null}
              readPermissions={READ_PERMISSIONS.filter((p) => p !== "brain.read")}
              accounts={accounts}
              employees={employees}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("brain.links.title")} description={t("brain.links.description")} />
        <CardBody>
          <DocumentLinks
            organizationId={org.id}
            companyId={company.id}
            documentId={doc.id}
            links={links}
            canManage={canManage}
            linkableTypes={linkable.filter((x): x is LinkSubjectType => x !== null)}
          />
        </CardBody>
      </Card>

      {citedIn ? (
        <Card>
          <CardHeader title={t("brain.citedIn.title")} description={t("brain.citedIn.description", { count: citedIn.length })} />
          {citedIn.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("brain.citedIn.empty")}</p>
          ) : (
            <ul className="divide-y">
              {citedIn.map((c) => (
                <li key={c.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                  <Link className="min-w-0 truncate font-medium hover:underline" href={`/${locale}/tasks/${c.taskId}`}>
                    {c.title}
                  </Link>
                  <TaskStatusBadge status={c.status} label={t(`agentTasks.status.${c.status}`)} />
                  <span className="flex flex-wrap gap-1">
                    {c.passages.map((n) => (
                      <a key={n} href={`#passage-${n}`} className="text-xs text-muted-foreground hover:underline">
                        {t("brain.passage", { n })}
                      </a>
                    ))}
                  </span>
                  <span className="ms-auto text-xs text-muted-foreground">{formatDateTime(c.createdAt, locale, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("brain.passages")} />
        <CardBody className="grid gap-3">
          {doc.passages.map((p) => (
            <section
              key={p.id}
              id={`passage-${p.number}`}
              aria-label={t("brain.passage", { n: p.number })}
              className="grid scroll-mt-20 gap-1 rounded-md border p-3 target:border-primary target:bg-primary/5"
            >
              <a href={`#passage-${p.number}`} className="text-xs font-medium text-muted-foreground hover:underline">
                {t("brain.passage", { n: p.number })}
              </a>
              <p className="whitespace-pre-wrap break-words text-sm">{p.text}</p>
            </section>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
