import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { CountryBillingToggle } from "@/components/admin/country-billing-toggle";
import { getLocale, getT } from "@/i18n/server";
import { displayName } from "@/i18n/format";
import { listCountries, listRegions } from "@/server/modules/globalization/service";
import { loadGrants } from "@/server/modules/rbac/service";
import { db } from "@/server/core/db";
import { requireViewer } from "@/server/session";

export default async function CountriesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const [countries, regions, grants] = await Promise.all([listCountries(), listRegions(), loadGrants(db(), "USER", viewer.user.id)]);
  const manage = grants.filter((g) => g.permissions.has("globalization.manage"));
  const canManage = (code: string, region: string) =>
    manage.some((g) => g.scopeType === "PLATFORM" || (g.scopeType === "REGION" && g.scopeId === region) || (g.scopeType === "COUNTRY" && g.scopeId === code));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title={t("admin.countries.regions")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.countries.code")}</Th>
              <Th>{t("admin.pricing.name")}</Th>
              <Th>{t("admin.countries.defaultCurrency")}</Th>
              <Th>{t("admin.countries.defaultLocale")}</Th>
              <Th>{t("admin.countries.timezone")}</Th>
              <Th>{t("admin.countries.dataRegion")}</Th>
            </Tr>
          </THead>
          <TBody>
            {regions.map((r) => (
              <Tr key={r.code}>
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td>{r.name}</Td>
                <Td className="font-mono text-xs">{r.defaultCurrency}</Td>
                <Td className="font-mono text-xs">{r.defaultLocale}</Td>
                <Td className="font-mono text-xs">{r.timezone}</Td>
                <Td>
                  <Badge>{t(`onboarding.dataRegions.${r.dataRegion}`)}</Badge>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader title={t("admin.countries.countries")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.countries.code")}</Th>
              <Th>{t("admin.pricing.name")}</Th>
              <Th>{t("admin.countries.region")}</Th>
              <Th>{t("admin.countries.defaultCurrency")}</Th>
              <Th>{t("admin.countries.defaultLocale")}</Th>
              <Th>{t("admin.countries.tax")}</Th>
              <Th>{t("admin.countries.paymentMethods")}</Th>
              <Th>{t("admin.countries.billing")}</Th>
              <Th>
                <span className="sr-only">{t("common.actions")}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {countries.map((c) => {
              const tax = c.taxConfigs[0];
              const name = displayName(c.code, "region", locale);
              return (
                <Tr key={c.code}>
                  <Td className="font-mono text-xs">{c.code}</Td>
                  <Td>{name}</Td>
                  <Td className="font-mono text-xs">{c.regionCode}</Td>
                  <Td className="font-mono text-xs">{c.supportedCurrencies.join(" · ")}</Td>
                  <Td className="font-mono text-xs">{c.defaultLocale}</Td>
                  <Td className="text-xs whitespace-nowrap">
                    {tax ? `${tax.displayName} · ${(tax.rateBps / 100).toLocaleString(locale)}%` : "—"}
                  </Td>
                  <Td className="max-w-56 truncate font-mono text-[11px] text-muted-foreground">{c.paymentMethods.join(", ")}</Td>
                  <Td>{c.billingEnabled ? <Badge tone="success">{t("common.enabled")}</Badge> : <Badge tone="danger">{t("common.disabled")}</Badge>}</Td>
                  <Td className="text-end">{canManage(c.code, c.regionCode) ? <CountryBillingToggle code={c.code} name={name} enabled={c.billingEnabled} /> : null}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
