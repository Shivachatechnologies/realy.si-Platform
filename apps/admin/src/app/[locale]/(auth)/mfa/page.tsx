import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaForm } from "@/components/auth/auth-forms";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { getSession } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.mfaTitle") };
}

/**
 * Two-factor step of the Control Center. The console gate sends every admin here whose session has not completed
 * MFA or whose last verification is older than the freshness window. Factors are enrolled in the user app
 * (Settings → Security), which is linked when the account has none yet.
 */
export default async function AdminMfaPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const user = await db().user.findUniqueOrThrow({ where: { id: session.userId }, select: { mfaEnabled: true } });
  const securityUrl = process.env.USER_APP_URL ? `${process.env.USER_APP_URL}/${locale}/settings/security` : null;
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("auth.mfaTitle")}</h1>
        <p className="text-muted-foreground">{user.mfaEnabled ? t("auth.mfaSubtitle") : t("admin.mfaNotice")}</p>
      </div>
      {user.mfaEnabled ? (
        <MfaForm />
      ) : (
        <Notice tone="warning">
          {t("authHero.adminValue3")}{" "}
          {securityUrl ? (
            <a className="font-medium underline" href={securityUrl}>
              {t("admin.openApp")}
            </a>
          ) : null}
        </Notice>
      )}
    </div>
  );
}
