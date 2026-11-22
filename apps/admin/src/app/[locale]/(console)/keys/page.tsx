import { AudioLines, BarChart3, Bot, Clapperboard, CreditCard, HardDrive, KeyRound, LogIn, Mail, MessageSquare, Palette, Phone, Plug, Search, Server } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { PlatformKeyRow } from "@/components/admin/platform-keys";
import { getLocale, getT } from "@/i18n/server";
import { listPlatformSecrets } from "@/server/modules/admin/platform-secrets";
import { requireViewer } from "@/server/session";

const GROUP_ICON: Record<string, ReactNode> = {
  ai: <Bot />,
  research: <Search />,
  creative: <Palette />,
  voice: <AudioLines />,
  video: <Clapperboard />,
  telephony: <Phone />,
  messaging: <MessageSquare />,
  storage: <HardDrive />,
  email: <Mail />,
  payments: <CreditCard />,
  login: <LogIn />,
  integrations: <Plug />,
  observability: <BarChart3 />,
  platform: <Server />,
};

/**
 * Platform keys (docs/platform-keys.md): every platform-level API key and setting an admin may enter here instead of
 * the hosting environment. Secret values are write-only — this page only ever receives their status and last 4.
 */
export default async function PlatformKeysPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(listPlatformSecrets(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const { groups, items, canManage } = r.value;
  const count = (s: string) => items.filter((i) => i.source === s).length;
  const blocked = [...new Set(items.filter((i) => i.source === "missing").flatMap((i) => i.blocks))];
  // A platform-managed provider is available to customers once every required key of it has a value.
  const providerReady = (provider: string) => items.filter((i) => i.provider === provider && i.blocks.length > 0).every((i) => i.source !== "missing");
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<KeyRound />} title={t("admin.keys.title")} description={t("admin.keys.subtitle")} why={t("admin.keys.why")} />
      <StatGrid>
        <StatTile label={t("admin.keys.status.admin")} value={count("admin")} />
        <StatTile label={t("admin.keys.status.host")} value={count("host")} />
        <StatTile label={t("admin.keys.status.missing")} value={count("missing")} tone={count("missing") ? "warning" : undefined} />
      </StatGrid>
      <Notice tone="info" title={t("admin.keys.precedenceTitle")}>
        {t("admin.keys.precedence")}
      </Notice>
      {blocked.length ? (
        <Notice tone="warning" title={t("admin.keys.blockedTitle")}>
          {blocked.map((b) => t(`admin.keys.features.${b}`)).join(", ")}
        </Notice>
      ) : null}
      {!canManage ? <Notice tone="info">{t("admin.keys.readOnly")}</Notice> : null}
      <Notice tone="info" title={t("admin.keys.managedTitle")}>
        {t("admin.keys.managedBody")}
      </Notice>
      {groups.map((g) => {
        const rows = items.filter((i) => i.group === g);
        if (!rows.length) return null;
        const missing = rows.filter((i) => i.source === "missing").length;
        return (
          <Card key={g} id={`keys-${g}`}>
            <CardHeader
              icon={GROUP_ICON[g]}
              title={t(`admin.keys.groups.${g}.title`)}
              description={t(`admin.keys.groups.${g}.hint`)}
              actions={<span className="text-xs text-muted-foreground tabular-nums">{t("admin.keys.configured", { set: rows.length - missing, total: rows.length })}</span>}
            />
            <div className="divide-y">
              {rows.map((item, idx) => (
                <div key={item.key}>
                  {/* Platform-managed providers: one sub-heading per provider, with whether customers can use it. */}
                  {item.provider && rows[idx - 1]?.provider !== item.provider ? (
                    <div className="flex items-center gap-2 bg-muted/40 px-4 py-2">
                      <span className="text-sm font-medium">{item.providerName}</span>
                      <span className={`ms-auto text-xs ${providerReady(item.provider) ? "text-success" : "text-muted-foreground"}`}>
                        {providerReady(item.provider) ? t("admin.keys.providerAvailable") : t("admin.keys.providerUnavailable")}
                      </span>
                    </div>
                  ) : null}
                  <PlatformKeyRow item={item} canManage={canManage} timeZone={viewer.user.timezone} />
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
