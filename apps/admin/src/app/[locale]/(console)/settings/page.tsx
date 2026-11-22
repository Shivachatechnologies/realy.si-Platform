import Link from "next/link";
import { Bell, Bot, CreditCard, Download, Globe2, KeyRound, Plug, Search, Settings, ShieldCheck, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AdminHeader, SectionLink, guard, sp } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { ControlValueEditor } from "@/components/admin/control-editors";
import { Timestamp } from "@/components/admin/timestamp";
import { SourceNote } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { canPlatform } from "@/server/modules/admin/access";
import { settingsCenter } from "@/server/modules/admin/controls";
import { requireViewer } from "@/server/session";

const ICONS: Record<string, ReactNode> = { general: <Globe2 />, authentication: <KeyRound />, ai: <Bot />, billing: <CreditCard />, integrations: <Plug />, notifications: <Bell />, security: <ShieldCheck />, operations: <Wrench /> };
/** Settings edited here (platform settings); other controls are edited on the page that owns them. */
const EDITABLE: Record<string, "text" | "select" | "lines"> = { platformName: "text", supportEmail: "text", maintenanceMessage: "text", defaultLocale: "select", signupDomainAllowlist: "lines" };
const OWNER_PAGE: Record<string, string> = { ai: "/ai/models", kill: "/controls", settings: "/settings" };

const show = (v: unknown, none: string) => (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) ? none : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? String(v) : String(v));

/** Settings center: grouped platform settings with search, values, owner links, per-key history and JSON export. */
export default async function AdminSettingsPage({ searchParams }: PageProps<"/[locale]/settings">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = sp((await searchParams).q);
  const r = await guard(Promise.all([settingsCenter(viewer.ctx, { q }), canPlatform(viewer.ctx, "platform.controls.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [c, canManage] = r.value;
  const base = `/${locale}`;
  const groups = c.groups.filter((g) => !q || g.keys.length || g.id.includes(q.toLowerCase()));
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<Settings />}
        title={t("admin.nav.settings")}
        description={t("admin.settings.subtitle")}
        why={t("admin.settings.why")}
        actions={
          <Button asChild size="sm" variant="secondary">
            <a href="/api/v1/admin/controls/export" download>
              <Download aria-hidden />
              {t("admin.settings.export")}
            </a>
          </Button>
        }
        meta={<SourceNote source="platform_settings · audit_logs" label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} extra={<span>{t("admin.settings.secretsNote")}</span>} />}
      />
      <form action={`${base}/settings`} className="flex items-center gap-2">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <Input name="q" type="search" defaultValue={q} placeholder={t("admin.settings.search")} aria-label={t("admin.settings.search")} className="w-full sm:w-80" maxLength={80} />
        {q ? <Link href={`${base}/settings`} className="text-xs text-primary hover:underline">{t("admin.common.clearFilters")}</Link> : null}
      </form>
      <nav aria-label={t("admin.settings.groupsNav")} className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <a key={g.id} href={`#settings-${g.id}`} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">
            {t(`admin.settings.groups.${g.id}.title`)}
          </a>
        ))}
      </nav>
      {groups.map((g) => (
        <Card key={g.id} id={`settings-${g.id}`}>
          <CardHeader
            icon={ICONS[g.id]}
            title={t(`admin.settings.groups.${g.id}.title`)}
            description={t(`admin.settings.groups.${g.id}.hint`)}
            actions={
              g.links.length ? (
                <div className="flex flex-wrap gap-2">
                  {g.links.map((l) => (
                    <SectionLink key={l} href={`${base}${l}`}>
                      {l}
                    </SectionLink>
                  ))}
                </div>
              ) : null
            }
          />
          {g.keys.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t(`admin.settings.groups.${g.id}.linkOnly`)}</p>
          ) : (
            <div className="divide-y">
              {g.keys.map((k) => {
                const label = t(`admin.controls.keys.${k.key}.label`);
                const hint = t(`admin.controls.keys.${k.key}.hint`);
                const editor = EDITABLE[k.key];
                return (
                  <div key={k.key} className="grid gap-1">
                    {editor && k.group === "settings" ? (
                      <ControlValueEditor
                        controlKey={k.key}
                        kind={editor}
                        value={k.value as never}
                        canManage={canManage}
                        label={label}
                        description={hint}
                        {...(k.key === "defaultLocale" ? { display: LOCALE_NAMES[k.value as keyof typeof LOCALE_NAMES] ?? String(k.value), choices: LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })) } : {})}
                        {...(k.key === "signupDomainAllowlist" ? { display: (k.value as string[]).length ? (k.value as string[]).join(", ") : t("admin.settings.anyDomain") } : {})}
                      />
                    ) : (
                      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">{hint}</p>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{k.key}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={JSON.stringify(k.value) === JSON.stringify(k.default) ? "neutral" : "warning"}>{show(k.value, t("admin.controls.notSet"))}</Badge>
                          <SectionLink href={`${base}${OWNER_PAGE[k.group] ?? "/controls"}`}>{t("admin.settings.editThere")}</SectionLink>
                        </div>
                      </div>
                    )}
                    <details className="px-4 pb-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        {k.meta ? t("admin.settings.lastChanged") : t("admin.settings.neverChanged")} {k.meta ? <Timestamp value={k.meta.updatedAt} mode="relative" /> : null} · {t("admin.settings.historyCount", { count: k.history.length })}
                      </summary>
                      {k.history.length ? (
                        <ul className="mt-1 grid gap-1">
                          {k.history.map((h) => (
                            <li key={h.id} className="flex flex-wrap gap-2">
                              <Timestamp value={h.createdAt} mode="absolute" className="text-muted-foreground" />
                              <span>{h.who ?? "—"}</span>
                              <span className="font-mono text-muted-foreground">{JSON.stringify((h.oldValue as Record<string, unknown> | null)?.[k.key] ?? null)} → {JSON.stringify((h.newValue as Record<string, unknown> | null)?.[k.key] ?? null)}</span>
                              {h.reason ? <span className="text-muted-foreground">“{h.reason}”</span> : null}
                              <Link href={`${base}/audit/${h.id}`} className="text-primary hover:underline">{t("admin.audit.view")}</Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
