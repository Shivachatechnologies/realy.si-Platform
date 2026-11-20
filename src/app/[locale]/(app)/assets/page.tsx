import type { Metadata } from "next";
import Link from "next/link";
import { Plug } from "lucide-react";
import { World } from "@/components/ui/world";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { AssetLibrary, type LibraryAsset } from "@/components/assets/asset-library";
import { GenerateArtworkDialog } from "@/components/assets/generate-dialog";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { imageProviderStatus, listAssets, scopeCounts, scopeOptions } from "@/server/modules/assets/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("assets.title") };
}

export default async function AssetsPage({ searchParams }: PageProps<"/[locale]/assets">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) {
    return (
      <World name="brain">
        <PageHeader variant="editorial" world="brain" eyebrow={t("assets.eyebrow")} title={t("assets.title")} description={t("assets.noCompany")} />
      </World>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "companies.read", chain))) {
    return (
      <World name="brain">
        <PageHeader variant="editorial" world="brain" eyebrow={t("assets.eyebrow")} title={t("assets.title")} />
        <Notice tone="warning" className="mt-6">{t("assets.forbidden")}</Notice>
      </World>
    );
  }
  const sp = await searchParams;
  const scope = typeof sp.scope === "string" ? sp.scope : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const [page, counts, scopes, providers, canManage] = await Promise.all([
    listAssets(viewer.ctx, org.id, company.id, { scopeType: scope, q }).catch(() => listAssets(viewer.ctx, org.id, company.id, {})),
    scopeCounts(viewer.ctx, org.id, company.id),
    scopeOptions(viewer.ctx, org.id, company.id),
    imageProviderStatus(org.id, company.id),
    can(viewer.ctx, "brain.manage", chain),
  ]);
  const initial: LibraryAsset[] = page.data.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }));

  return (
    <World name="brain">
      <div className="mx-auto grid max-w-[1400px] gap-8">
        <PageHeader
          variant="editorial"
          world="brain"
          eyebrow={t("assets.eyebrow")}
          title={t("assets.title")}
          description={t("assets.description")}
          meta={
            providers.any ? (
              <Badge tone="success">{t("assets.connectedVia", { providers: providers.connected.join(", ") })}</Badge>
            ) : (
              <Badge tone="warning">{t("assets.notConnected.title")}</Badge>
            )
          }
          actions={
            canManage ? (
              <>
                <GenerateArtworkDialog organizationId={org.id} companyId={company.id} connected={providers.connected} scopes={scopes} />
                {!providers.any ? (
                  <Button asChild variant="glass">
                    <Link href={`/${locale}/integrations`}>
                      <Plug aria-hidden />
                      {t("assets.notConnected.action")}
                    </Link>
                  </Button>
                ) : null}
              </>
            ) : null
          }
        />
        <AssetLibrary organizationId={org.id} companyId={company.id} initial={initial} nextCursor={page.nextCursor} counts={counts} canManage={canManage} connected={providers.connected} scopes={scopes} />
      </div>
    </World>
  );
}
