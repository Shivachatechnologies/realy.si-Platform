import type { Metadata } from "next";
import { ProductAreaTabs } from "@/components/work/product-nav";
import { workContext } from "@/components/work/context";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { RoadmapGrid } from "@/components/work/product-roadmap";
import { HelpStrip, RoadmapChart } from "@/components/work/product-studio";
import { ProductFilter } from "@/components/work/product-ui";
import { getT } from "@/i18n/server";
import { getRoadmap } from "@/server/modules/work/product";
import { productOptions } from "@/server/modules/work/product-core";
import { param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.tabs.roadmap") };
}

export default async function RoadmapPage({ searchParams }: PageProps<"/[locale]/product/roadmap">) {
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"), t("work.product.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base } = w;
  const raw = await searchParams;
  const productParam = param(raw, "product");
  const products = await productOptions(org.id, company.id);
  const productId = products.some((p) => p.id === productParam) ? productParam : undefined;
  const r = await getRoadmap(viewer.ctx, org.id, company.id, { start: param(raw, "start"), productId });
  return (
    <div className="mx-auto grid max-w-[1600px] min-w-0 gap-4">
      {w.header}
      <ProductAreaTabs t={t} locale={locale} active="roadmap" />
      <HelpStrip t={t} area="roadmapAll" />
      <Card variant="elevated">
        <CardHeader title={t("product.roadmapChart.title")} description={t("product.roadmapChart.hint")} />
        <CardBody>
          <RoadmapChart t={t} quarters={r.quarters} features={r.features} />
        </CardBody>
      </Card>
      <RoadmapGrid
        t={t}
        locale={locale}
        base={base}
        canManage={canManage}
        r={r}
        path={`/${locale}/product/roadmap`}
        productId={productId}
        products={products}
        filter={<ProductFilter path={`/${locale}/product/roadmap`} products={products} value={productId} label={t("product.product")} allLabel={t("product.allProducts")} />}
      />
    </div>
  );
}
