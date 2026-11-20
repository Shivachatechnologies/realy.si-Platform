import { notFound, redirect } from "next/navigation";
import { workContext } from "@/components/work/context";
import { db } from "@/server/core/db";
import { isUuid } from "@/server/modules/work/shared";

/** Stable link to a product document (used by Company Brain sources): redirects into the product workspace. */
export default async function ProductDocLink({ params }: PageProps<"/[locale]/product/docs/[docId]">) {
  const { docId } = await params;
  const w = await workContext("projects", "");
  if (w.gate) return w.gate;
  if (!isUuid(docId)) notFound();
  const doc = await db().productDoc.findFirst({ where: { id: docId, organizationId: w.org.id, companyId: w.company.id }, select: { productId: true, kind: true } });
  if (!doc) notFound();
  redirect(`/${w.locale}/product/${doc.productId}/documents/${doc.kind.toLowerCase()}`);
}
