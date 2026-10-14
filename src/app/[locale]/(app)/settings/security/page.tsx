import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MfaSetup } from "@/components/settings/mfa-setup";
import { getLocale, getT } from "@/i18n/server";
import { requireViewer } from "@/server/session";

export default async function SecuritySettingsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  return (
    <Card>
      <CardHeader title={t("settings.security.title")} />
      <CardBody>
        <MfaSetup enabled={viewer.user.mfaEnabled} />
      </CardBody>
    </Card>
  );
}
