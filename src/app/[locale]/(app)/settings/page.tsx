import { EmailStatus, ProfileForm } from "@/components/settings/profile-form";
import { db } from "@/server/core/db";
import { getLocale } from "@/i18n/server";
import { requireViewer } from "@/server/session";
import { listCountries } from "@/server/modules/globalization/service";

export default async function ProfileSettingsPage() {
  const locale = await getLocale();
  const viewer = await requireViewer(locale);
  const [countries, me] = await Promise.all([listCountries(), db().user.findUniqueOrThrow({ where: { id: viewer.user.id }, select: { emailVerifiedAt: true } })]);
  return (
    <div className="grid gap-4">
      <EmailStatus email={viewer.user.email} verified={!!me.emailVerifiedAt} />
      <ProfileForm user={viewer.user} countryCodes={countries.map((c) => c.code)} />
    </div>
  );
}
