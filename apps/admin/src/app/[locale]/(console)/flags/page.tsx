import { Notice } from "@/components/ui/notice";
import { FlagCard } from "@/components/admin/flags";
import { Flag } from "lucide-react";
import { AdminHeader, EmptyState } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { listFlags } from "@/server/modules/flags/service";
import { can } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { requireViewer } from "@/server/session";

export default async function FlagsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let flags: Awaited<ReturnType<typeof listFlags>>;
  try {
    flags = await listFlags(viewer.ctx);
  } catch (e) {
    if (isAppError(e) && e.code === "forbidden") return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
    throw e;
  }
  const editable = await can(viewer.ctx, "flags.manage", platformChain());
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Flag />} title={t("admin.nav.flags")} description={t("admin.flags.subtitle")} why={t("admin.flags.why")} />
      {flags.length === 0 ? <EmptyState icon={<Flag />} title={t("admin.flags.emptyTitle")} body={t("admin.flags.emptyBody")} /> : null}
      <div className="stagger grid gap-4 lg:grid-cols-2">
      {flags.map((f) => (
        <FlagCard key={f.id} editable={editable} flag={{ id: f.id, key: f.key, description: f.description, defaultEnabled: f.defaultEnabled, rules: f.rules }} />
      ))}
      </div>
    </div>
  );
}
