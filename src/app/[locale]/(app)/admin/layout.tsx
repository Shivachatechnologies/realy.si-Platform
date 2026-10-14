import { Notice } from "@/components/ui/notice";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { getLocale, getT } from "@/i18n/server";
import { requireViewer } from "@/server/session";
import { platformGrants } from "@/server/workspace";

export default async function AdminLayout({ children }: LayoutProps<"/[locale]/admin">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const grants = await platformGrants(viewer.user.id);
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <h1 className="text-lg font-semibold tracking-tight">{t("admin.title")}</h1>
      {grants.length === 0 ? (
        <Notice tone="warning">{t("admin.noAccess")}</Notice>
      ) : (
        <>
          <AdminTabs />
          {!viewer.user.mfaEnabled ? <Notice tone="warning">{t("admin.mfaNotice")}</Notice> : null}
          {children}
        </>
      )}
    </div>
  );
}
