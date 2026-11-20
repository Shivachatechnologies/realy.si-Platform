import type { Metadata } from "next";
import Link from "next/link";
import { InstallationActions } from "@/components/marketplace/install-panel";
import { InstallSummaryList } from "@/components/marketplace/install-summary";
import { catalogText, TYPE_ICON } from "@/components/marketplace/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { listInstallations, type InstallSummary } from "@/server/modules/marketplace/install";
import { compareVersions } from "@/server/modules/marketplace/manifest";
import { resolveListing } from "@/server/modules/marketplace/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketplace.tabs.installed") };
}

const ITEM_HREF: Record<string, string> = {
  project: "/projects",
  objective: "/objectives",
  milestone: "/objectives",
  department: "/hr",
  team: "/hr",
  role: "/settings/roles",
  work_task: "/projects",
};

export default async function InstalledPage({ searchParams }: PageProps<"/[locale]/marketplace/installed">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) return <Card className="p-4 text-muted-foreground">{t("company.empty")}</Card>;
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "marketplace.read", chain))) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
  const showAll = (await searchParams).all === "1";
  const [installations, canInstall] = await Promise.all([
    listInstallations(viewer.ctx, org.id, company.id, {
      includeUninstalled: showAll,
    }),
    can(viewer.ctx, "marketplace.install", chain),
  ]);
  const text = catalogText(t);
  const listings = new Map(await Promise.all(installations.map(async (i) => [i.listingKey, await resolveListing(db(), i.listingKey, org.id, { text })] as const)));
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = viewer.user.timezone;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("marketplace.installed.subtitle", { company: company.name })}</p>
        <Link href={`/${locale}/marketplace/installed${showAll ? "" : "?all=1"}`} className="text-sm text-primary hover:underline">
          {showAll ? t("marketplace.installed.activeOnly") : t("marketplace.installed.showUninstalled")}
        </Link>
      </div>
      {installations.length === 0 ? (
        <Card className="grid gap-2 p-8 text-center">
          <p className="text-muted-foreground">{t("marketplace.installed.empty")}</p>
          <Link href={`/${locale}/marketplace?type=INDUSTRY_BLUEPRINT`} className="text-sm text-primary hover:underline">
            {t("marketplace.installed.browseBlueprints")}
          </Link>
        </Card>
      ) : (
        installations.map((i) => {
          const listing = listings.get(i.listingKey) ?? null;
          const Icon = TYPE_ICON[i.listingType];
          const newer = listing ? listing.versions.filter((v) => compareVersions(v.version, i.version) > 0).map((v) => v.version) : [];
          const byType = new Map<string, typeof i.items>();
          for (const it of i.items) byType.set(it.entityType, [...(byType.get(it.entityType) ?? []), it]);
          return (
            <Card key={i.id} id={i.id} className="scroll-mt-20">
              <CardBody className="grid gap-3">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    {listing ? (
                      <Link href={`/${locale}/marketplace/${i.listingKey}`} className="font-medium hover:underline">
                        {listing.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{i.listingName}</span>
                    )}
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge tone="accent">{t(`marketplace.types.${i.listingType}`)}</Badge>
                      <span>v{i.version}</span>
                      <span>
                        {t("marketplace.installed.on", {
                          date: formatDate(i.installedAt, locale, tz),
                        })}
                      </span>
                      {i.pinned ? <Badge>{t("marketplace.install.pinned")}</Badge> : null}
                      {i.status === "UNINSTALLED" ? <Badge tone="warning">{t("marketplace.installed.uninstalled")}</Badge> : null}
                      {i.status === "ACTIVE" && newer.length && !i.pinned ? (
                        <Badge tone="success">
                          {t("marketplace.installed.updateAvailable", {
                            version: newer[0]!,
                          })}
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                </div>
                <InstallSummaryList summary={i.summary as unknown as InstallSummary} />
                {i.items.length ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      {t("marketplace.installed.items", {
                        count: i.items.length,
                      })}
                    </summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {[...byType.entries()].map(([type, items]) => (
                        <div key={type} className="grid gap-1">
                          <p className="text-xs font-medium uppercase text-muted-foreground">{t(`marketplace.entityTypes.${type}`)}</p>
                          <ul className="grid gap-0.5">
                            {items.map((it) => (
                              <li key={it.id} className="truncate">
                                {ITEM_HREF[type] ? (
                                  <Link href={`/${locale}${ITEM_HREF[type]}`} className="hover:underline">
                                    {it.name}
                                  </Link>
                                ) : (
                                  it.name
                                )}
                                <span className="ms-1 text-xs text-muted-foreground">v{it.version}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
                {i.status === "ACTIVE" ? (
                  <InstallationActions
                    base={base}
                    canInstall={canInstall}
                    installation={{
                      id: i.id,
                      version: i.version,
                      pinned: i.pinned,
                    }}
                    newerVersions={newer}
                  />
                ) : null}
                {i.status === "UNINSTALLED" && listing ? (
                  <Link href={`/${locale}/marketplace/${i.listingKey}`} className="text-sm text-primary hover:underline">
                    {t("marketplace.installed.reinstall")}
                  </Link>
                ) : null}
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
