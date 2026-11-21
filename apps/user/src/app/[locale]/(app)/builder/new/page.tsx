import type { Metadata } from "next";
import Link from "next/link";
import { BuilderFrame } from "@/components/builder/frame";
import { NewRunForm } from "@/components/builder/new-run-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { activeRunFor } from "@/server/modules/builder/service";
import { companyFormOptions } from "@/server/modules/globalization/options";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("builder.new.title") };
}

const MODES = ["NEW_IDEA", "EXISTING", "IMPORT"] as const;

/** /builder/new?mode=NEW_IDEA|EXISTING|IMPORT — start the builder for the active company. */
export default async function NewBuilderRunPage({ searchParams }: PageProps<"/[locale]/builder/new">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = await searchParams;
  const raw = typeof sp.mode === "string" ? sp.mode.toUpperCase() : "";
  const mode = (MODES as readonly string[]).includes(raw) ? (raw as (typeof MODES)[number]) : raw === "NEW" ? "NEW_IDEA" : "NEW_IDEA";
  const tab = mode === "EXISTING" ? "existing" : mode === "IMPORT" ? "import" : "new";
  const frame = (children: React.ReactNode) => (
    <BuilderFrame locale={locale} active={tab} title={t(`builder.new.titles.${mode}`)} description={t(`builder.new.descriptions.${mode}`)}>
      {children}
    </BuilderFrame>
  );
  if (!company) return frame(<Notice tone="info" action={<Button asChild size="sm"><Link href={`/${locale}/onboarding?step=business`}>{t("builder.addBusiness")}</Link></Button>}>{t("company.empty")}</Notice>);
  if (!(await can(viewer.ctx, "companies.manage", await companyChain(db(), org.id, company.id)))) return frame(<Notice tone="warning">{t("errors.forbidden")}</Notice>);
  const active = await activeRunFor(viewer.ctx, org.id, company.id);
  if (active) {
    return frame(
      <Notice tone="info" action={<Button asChild size="sm"><Link href={`/${locale}/builder/${active.id}`}>{t("builder.open")}</Link></Button>}>
        {t(`builder.activeNotice.${active.status}`, { name: company.name })}
      </Notice>,
    );
  }
  const options = await companyFormOptions();
  return frame(
    <Card>
      <CardHeader title={t("builder.new.questions", { name: company.name })} description={t("builder.onboarding.questions.description")} />
      <CardBody>
        <NewRunForm
          base={`/api/v1/organizations/${org.id}/companies/${company.id}`}
          mode={mode}
          countries={options.countries.map((c) => c.code)}
          currencies={options.currencies}
          defaultCurrency={company.baseCurrency}
          defaultCountry={company.incorporationCountryCode ?? viewer.user.countryCode}
        />
      </CardBody>
    </Card>,
  );
}
