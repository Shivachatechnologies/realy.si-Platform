import type { Metadata } from "next";
import { productWorkspace } from "@/components/work/product-ui";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { RoadmapGrid } from "@/components/work/product-roadmap";
import { RoadmapChart } from "@/components/work/product-studio";
import { getT } from "@/i18n/server";
import { getRoadmap } from "@/server/modules/work/product";
import { param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.tabs.roadmap") };
}

export default async function ProductRoadmapPage({ params, searchParams }: PageProps<"/[locale]/product/[productId]/roadmap">) {
  const { productId } = await params;
  const w = await productWorkspace(productId, "roadmap");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company, base, canEdit } = w;
  const raw = await searchParams;
  const r = await getRoadmap(viewer.ctx, org.id, company.id, { start: param(raw, "start"), productId });
  return (
    <div className="mx-auto grid max-w-[1600px] min-w-0 gap-4">
      {w.header}
      <Card variant="elevated">
        <CardHeader title={t("product.roadmapChart.title")} description={t("product.roadmapChart.hint")} />
        <CardBody>
          <RoadmapChart t={t} quarters={r.quarters} features={r.features.filter((f) => f.status !== "CANCELLED")} />
        </CardBody>
      </Card>
      <RoadmapGrid t={t} locale={locale} base={base} canManage={canEdit} r={r} path={`/${locale}/product/${productId}/roadmap`} productId={productId} />
    </div>
  );
}
