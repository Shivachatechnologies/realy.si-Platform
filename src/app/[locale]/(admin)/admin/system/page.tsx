import { Card, CardHeader } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { can } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { systemStatus } from "@/server/modules/admin/system-status";
import { requireViewer } from "@/server/session";

export default async function SystemStatusPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  if (!(await can(viewer.ctx, "platform.security.read", platformChain())) && !(await can(viewer.ctx, "platform.organizations.read", platformChain()))) {
    return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
  }
  const services = await systemStatus();
  return (
    <Card>
      <CardHeader title={t("admin.system.title")} description={t("admin.system.description")} />
      <ul className="divide-y">
        {services.map((s) => (
          <li key={s.key} className="flex items-center gap-3 px-4 py-2.5">
            <StatusDot tone={s.configured ? "success" : "neutral"} />
            <span>{t(`admin.system.services.${s.key}`)}</span>
            <span className={`ms-auto text-xs ${s.configured ? "text-success" : "text-muted-foreground"}`}>
              {s.configured ? t("admin.system.configured") : t("admin.system.notConfigured")}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
