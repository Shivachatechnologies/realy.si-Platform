import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, guard } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopilotPanel } from "@/components/admin/copilot/copilot-panel";
import { getLocale, getT } from "@/i18n/server";
import { copilotCapabilities } from "@/server/modules/admin/copilot";
import { requireViewer } from "@/server/session";

/** Admin Copilot (read-only): answers from permission-filtered platform tools, cited and linked. */
export default async function AdminCopilotPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(copilotCapabilities(viewer.ctx), t("admin.copilot.forbidden"));
  if (!r.ok) return r.node;
  const c = r.value;
  const suggestions = ["health", "failedJobs", "spenders", "pastDue", "integrations", "inactive"].map((k) => t(`admin.copilot.suggestions.${k}`));
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader icon={<Sparkles />} title={t("admin.copilot.title")} description={t("admin.copilot.subtitle")} why={t("admin.copilot.why")} />
      {c.killSwitch ? (
        <Notice tone="danger" title={t("admin.copilot.killSwitch")} action={<Link className="text-sm text-primary hover:underline" href={`/${locale}/ai/budgets`}>{t("admin.aiBudgets.nav")}</Link>}>
          {t("admin.copilot.killSwitchBody")}
        </Notice>
      ) : !c.configured ? (
        <Notice tone="warning" title={t("admin.copilot.notConfigured")} action={<Link className="text-sm text-primary hover:underline" href={`/${locale}/keys`}>{t("admin.aiRequests.openKeys")}</Link>}>
          {t("admin.copilot.notConfiguredBody")}
        </Notice>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={<Sparkles />} title={t("admin.copilot.conversation")} description={t("admin.copilot.conversationHint")} />
          <CardBody>{c.enabled ? <CopilotPanel base={`/${locale}`} suggestions={suggestions} /> : <p className="text-sm text-muted-foreground">{t("admin.copilot.unavailable")}</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title={t("admin.copilot.tools")} description={t("admin.copilot.toolsHint")} />
          <CardBody className="grid gap-2 text-xs">
            {c.tools.length === 0 ? (
              <p className="text-muted-foreground">{t("admin.copilot.noTools")}</p>
            ) : (
              c.tools.map((tool) => (
                <div key={tool.name}>
                  <Badge className="font-mono">{tool.name}</Badge>
                  <p className="mt-0.5 text-muted-foreground">{tool.description}</p>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
