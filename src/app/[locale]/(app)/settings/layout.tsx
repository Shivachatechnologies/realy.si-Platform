import Link from "next/link";
import { SettingsTabs } from "@/components/settings/tabs";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { orgAccessViolations } from "@/server/modules/enterprise/policy";
import { getSession, getWorkspaceContext, requireViewer } from "@/server/session";

export default async function SettingsLayout({ children }: LayoutProps<"/[locale]/settings">) {
  const locale = await getLocale();
  const t = await getT(locale);
  // Surface the organization's security policy (enforced by Enterprise OS services) so members know how to comply.
  const session = await getSession();
  let violations: string[] = [];
  if (session && !session.mfaPending) {
    const viewer = await requireViewer(locale);
    const { org } = await getWorkspaceContext(viewer.user.id);
    if (org) violations = await orgAccessViolations(viewer.ctx, org.id);
  }
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <h1 className="text-lg font-semibold tracking-tight">{t("settings.title")}</h1>
      <SettingsTabs />
      {violations.includes("mfa_required") ? (
        <Notice tone="warning">
          {t("enterprise.policy.mfaRequired")}{" "}
          <Link href={`/${locale}/settings/security`} className="underline">
            {t("enterprise.policy.setUpMfa")}
          </Link>
        </Notice>
      ) : null}
      {violations.includes("session_expired") ? <Notice tone="warning">{t("enterprise.policy.sessionExpired")}</Notice> : null}
      {violations.includes("ip_blocked") ? <Notice tone="danger">{t("enterprise.policy.ipBlocked")}</Notice> : null}
      {children}
    </div>
  );
}
