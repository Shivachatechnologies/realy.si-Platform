import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MfaSetup } from "@/components/settings/mfa-setup";
import { getLocale, getT } from "@/i18n/server";
import { requireViewer } from "@/server/session";
import { OAuthButtons, OAuthErrorNotice } from "@/components/auth/oauth-buttons";
import { linkedProviders, oauthStatus } from "@/server/modules/auth/oauth";

export default async function SecuritySettingsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const linked = await linkedProviders(viewer.user.id);
  return (
    <div className="grid gap-4">
      <OAuthErrorNotice />
      <Card>
        <CardHeader title={t("settings.security.title")} />
        <CardBody>
          <MfaSetup enabled={viewer.user.mfaEnabled} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("settings.security.connections")} />
        <CardBody className="max-w-md">
          <OAuthButtons providers={oauthStatus()} mode="link" linked={linked.map((l) => l.provider)} />
        </CardBody>
      </Card>
    </div>
  );
}
