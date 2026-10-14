import { SettingsTabs } from "@/components/settings/tabs";
import { getT } from "@/i18n/server";

export default async function SettingsLayout({ children }: LayoutProps<"/[locale]/settings">) {
  const t = await getT();
  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <h1 className="text-lg font-semibold tracking-tight">{t("settings.title")}</h1>
      <SettingsTabs />
      {children}
    </div>
  );
}
