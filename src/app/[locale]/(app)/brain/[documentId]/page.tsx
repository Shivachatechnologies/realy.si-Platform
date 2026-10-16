import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DeleteDocumentButton } from "@/components/brain/delete-document-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { getDocument } from "@/server/modules/brain/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.brain.title") };
}

export default async function BrainDocumentPage({ params }: PageProps<"/[locale]/brain/[documentId]">) {
  const { documentId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const doc = await getDocument(viewer.ctx, org.id, company.id, documentId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const canManage = await can(viewer.ctx, "brain.manage", await companyChain(db(), org.id, company.id));

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <Link href={`/${locale}/brain`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("modules.brain.title")}
      </Link>
      <Card>
        <CardHeader
          title={doc.title}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {doc.filename ? <span>{doc.filename}</span> : null}
              <Badge>{doc.mimeType}</Badge>
              <span>{t("brain.passageCount", { count: doc.passages.length })}</span>
              <span>{formatDate(doc.createdAt, locale, viewer.user.timezone)}</span>
            </span>
          }
          actions={canManage ? <DeleteDocumentButton organizationId={org.id} companyId={company.id} documentId={doc.id} /> : null}
        />
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
