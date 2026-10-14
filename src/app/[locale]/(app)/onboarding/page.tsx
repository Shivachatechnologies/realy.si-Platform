import { CompanyForm } from "@/components/company/company-form";
import { Card, CardBody } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { companyFormOptions } from "@/server/modules/globalization/options";
import { getWorkspaceContext, requireViewer } from "@/server/session";

export default async function OnboardingPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { org } = await getWorkspaceContext(viewer.user.id);
  const options = await companyFormOptions();
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("onboarding.title")}</h1>
        <p className="text-muted-foreground">{t("onboarding.subtitle")}</p>
      </div>
      <Card>
        <CardBody>
          <CompanyForm countries={options.countries} currencies={options.currencies} organizationId={org?.id ?? null} />
        </CardBody>
      </Card>
    </div>
  );
}
