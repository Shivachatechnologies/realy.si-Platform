import { ProfileForm } from "@/components/settings/profile-form";
import { getLocale } from "@/i18n/server";
import { requireViewer } from "@/server/session";
import { listCountries } from "@/server/modules/globalization/service";

export default async function ProfileSettingsPage() {
  const locale = await getLocale();
  const viewer = await requireViewer(locale);
  const countries = await listCountries();
  return <ProfileForm user={viewer.user} countryCodes={countries.map((c) => c.code)} />;
}
