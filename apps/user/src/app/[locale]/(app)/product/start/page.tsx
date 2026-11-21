import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { workContext } from "@/components/work/context";
import { StartWizard } from "@/components/work/product-client";
import { StudioHero } from "@/components/work/product-studio";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { isUuid, param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("product.start.title") };
}

/** "Start here": the guided idea intake (resumable: ?product=<id>). */
export default async function StartPage({ searchParams }: PageProps<"/[locale]/product/start">) {
  const t = await getT();
  const w = await workContext("projects", t("product.start.title"));
  if (w.gate) return w.gate;
  const { locale, org, company, canManage, canRunAgents, base } = w;
  const raw = await searchParams;
  const id = param(raw, "product");
  const p = isUuid(id) ? await db().product.findFirst({ where: { id, organizationId: org.id, companyId: company.id, archivedAt: null } }) : null;
  const initial = { productId: p?.id ?? null, name: p?.name ?? "", description: p?.description ?? "", targetUsers: p?.targetUsers ?? "", hasProject: !!p?.developmentProjectId };
  const startStep = !p || !p.description ? 0 : !p.targetUsers ? 1 : 2;
  return (
    <div className="mx-auto grid max-w-[860px] min-w-0 gap-4">
      <Link href={`/${locale}/product`} className="text-sm text-muted-foreground hover:underline">
        ← {t("product.tabs.products")}
      </Link>
      <StudioHero eyebrow={t("product.studio")} title={t("product.start.title")} description={t("product.start.subtitle")} />
      {canManage ? (
        <Card variant="elevated">
          <CardBody>
            <StartWizard base={base} locale={locale} initial={initial} startStep={startStep} aiAvailable={canRunAgents && aiConfigured()} />
          </CardBody>
        </Card>
      ) : (
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      )}
    </div>
  );
}
