import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sitesPage } from "@/components/sites/context";
import { DomainPanel } from "@/components/sites/settings-form";
import { getT } from "@/i18n/server";
import { txtName, txtValue } from "@/server/modules/sites/domain";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("sites.tabs.domain")} · ${t("sites.title")}` };
}

/** /website/domain — custom domain with DNS TXT verification and an honest status. */
export default async function SiteDomainPage() {
  const p = await sitesPage("domain");
  if (p.gate) return p.gate;
  const { locale, perms, base, site, tz, wrap } = p;
  if (!site) redirect(`/${locale}/website`);
  return wrap(
    <DomainPanel
      base={base}
      site={{ slug: site.slug, customDomain: site.customDomain, domainStatus: site.domainStatus, domainCheckedAt: site.domainCheckedAt?.toISOString() ?? null, domainVerifiedAt: site.domainVerifiedAt?.toISOString() ?? null, domainError: site.domainError }}
      txtName={site.customDomain ? txtName(site.customDomain) : null}
      txtValue={site.domainToken ? txtValue(site.domainToken) : null}
      canManage={perms.manage}
      tz={tz}
    />,
  );
}
