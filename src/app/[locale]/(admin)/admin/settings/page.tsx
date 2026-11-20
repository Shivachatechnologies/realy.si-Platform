import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, guard } from "@/components/admin/kit";
import { ControlValueEditor } from "@/components/admin/control-editors";
import { getLocale, getT } from "@/i18n/server";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { canPlatform } from "@/server/modules/admin/access";
import { listControls } from "@/server/modules/admin/controls";
import { requireViewer } from "@/server/session";

/** Platform settings: name, support email, default locale and the sign-up domain allowlist (enforced in signUp). */
export default async function AdminSettingsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(listControls(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const c = r.value.controls;
  const canManage = await canPlatform(viewer.ctx, "platform.controls.manage");
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.settings")} description={t("admin.settings.subtitle")} />
      <Card>
        <CardHeader title={t("admin.settings.general")} />
        <div className="divide-y">
          <ControlValueEditor controlKey="platformName" kind="text" value={c.platformName} canManage={canManage} label={t("admin.controls.keys.platformName.label")} description={t("admin.controls.keys.platformName.hint")} />
          <ControlValueEditor controlKey="supportEmail" kind="text" value={c.supportEmail} canManage={canManage} label={t("admin.controls.keys.supportEmail.label")} description={t("admin.controls.keys.supportEmail.hint")} />
          <ControlValueEditor
            controlKey="defaultLocale"
            kind="select"
            value={c.defaultLocale}
            display={LOCALE_NAMES[c.defaultLocale as keyof typeof LOCALE_NAMES] ?? c.defaultLocale}
            choices={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
            canManage={canManage}
            label={t("admin.controls.keys.defaultLocale.label")}
            description={t("admin.controls.keys.defaultLocale.hint")}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("admin.settings.registration")} />
        <div className="divide-y">
          <ControlValueEditor controlKey="signupDomainAllowlist" kind="lines" value={c.signupDomainAllowlist} canManage={canManage} label={t("admin.controls.keys.signupDomainAllowlist.label")} description={t("admin.controls.keys.signupDomainAllowlist.hint")} display={c.signupDomainAllowlist.length ? c.signupDomainAllowlist.join(", ") : t("admin.settings.anyDomain")} />
        </div>
      </Card>
    </div>
  );
}
