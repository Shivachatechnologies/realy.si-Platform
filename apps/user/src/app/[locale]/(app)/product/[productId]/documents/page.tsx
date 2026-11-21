import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { DOC_STATUS_TONE, productWorkspace } from "@/components/work/product-ui";
import { formatDateTime } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { listDocs } from "@/server/modules/work/product-docs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("product.workspace.tabs.documents") };
}

export default async function DocumentsPage({ params }: PageProps<"/[locale]/product/[productId]/documents">) {
  const { productId } = await params;
  const w = await productWorkspace(productId, "documents");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company, tz } = w;
  const docs = await listDocs(viewer.ctx, org.id, company.id, productId);
  return (
    <div className="mx-auto grid max-w-[1200px] min-w-0 gap-4">
      {w.header}
      <Card>
        <CardHeader title={t("product.workspace.tabs.documents")} description={t("product.docs.hint")} />
        <ul className="grid divide-y">
          {docs.map(({ kind, doc }) => (
            <li key={kind}>
              <Link href={`/${locale}/product/${productId}/documents/${kind.toLowerCase()}`} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm hover:bg-muted">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t(`product.docKinds.${kind}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`product.docHints.${kind}`)}</span>
                </span>
                {doc ? (
                  <>
                    <Badge tone={DOC_STATUS_TONE[doc.status]}>{t(`product.docStatus.${doc.status}`)}</Badge>
                    <Badge>v{doc.currentVersion}</Badge>
                    {doc.aiDraft ? <Badge tone="brand">AI</Badge> : null}
                    {doc.brainDocumentId ? <Badge tone="info">{t("product.docs.inBrain")}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{formatDateTime(doc.updatedAt, locale, tz)}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("product.docs.notStarted")}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
