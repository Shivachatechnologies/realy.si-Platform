import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import type { Translate } from "@/i18n/translate";
import { AppError } from "@/server/core/errors";
import { Rocket } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { productHeader } from "@/server/modules/work/product-core";
import { workContext } from "./context";
import { ProductWorkspaceTabs, type WorkspaceTab } from "./product-nav";
import { HelpStrip } from "./product-studio";

export { ProductFilter } from "./product-client";

export const PRODUCT_STATUS_TONE = { ACTIVE: "success", ON_HOLD: "warning", SUNSET: "neutral" } as const;
export const DOC_STATUS_TONE = { DRAFT: "neutral", IN_REVIEW: "warning", APPROVED: "success" } as const;
export const VALIDATION_TONE = { PENDING: "neutral", VALIDATED: "success", INVALIDATED: "danger", INCONCLUSIVE: "warning" } as const;
export const SENTIMENT_TONE = { POSITIVE: "success", NEUTRAL: "neutral", NEGATIVE: "danger" } as const;
export const PLAN_TONE = { RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" } as const;

export function StageBadge({ t, stage }: { t: Translate; stage: string }) {
  return <Badge tone="accent">{t(`product.stages.${stage}`)}</Badge>;
}

/**
 * Loader for the product workspace pages: work context, product header (404 for unknown products) and the
 * workspace header + tabs.
 */
export async function productWorkspace(productId: string, tab: WorkspaceTab) {
  const w = await workContext("projects", "");
  if (w.gate) return { gate: w.gate } as const;
  const { t, locale, viewer, org, company } = w;
  const product = await productHeader(viewer.ctx, org.id, company.id, productId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const header = (
    <div className="grid gap-3">
      <Link href={`/${locale}/product`} className="text-sm text-muted-foreground hover:underline">
        ← {t("product.tabs.products")}
      </Link>
      <PageHeader
        eyebrow={t("product.studio")}
        icon={<Rocket />}
        title={product.name}
        description={product.description ?? undefined}
        meta={
          <>
            <StageBadge t={t} stage={product.stage} />
            <Badge tone={PRODUCT_STATUS_TONE[product.status]}>{t(`product.status.${product.status}`)}</Badge>
          </>
        }
      />
      {product.archivedAt ? <Notice tone="warning">{t("work.archivedNotice")}</Notice> : null}
      <ProductWorkspaceTabs t={t} locale={locale} productId={product.id} active={tab} />
      {tab !== "overview" ? <HelpStrip t={t} area={tab} /> : null}
    </div>
  );
  return { ...w, gate: null, product, header, canEdit: w.canManage && !product.archivedAt } as const;
}
