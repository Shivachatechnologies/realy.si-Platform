"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/form-error";
import { useShell } from "@/components/shell/shell-context";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

interface Prefs {
  density: "comfortable" | "compact";
  timeRange: "24h" | "7d" | "30d" | "90d";
  collapsed: boolean;
  minSeverity: "INFO" | "WARNING" | "CRITICAL";
  muted: string[];
}

/** Personal console preferences (own row only; not audited): density, default range, sidebar, notification filters. */
export function PreferencesForm({ initial, types }: { initial: Prefs; types: string[] }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const shell = useShell();
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty = JSON.stringify(p) !== JSON.stringify(initial);
  const allTypes = [...new Set([...types, ...p.muted])].sort();
  return (
    <form
      className="grid gap-4 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await api("/api/v1/admin/me/preferences", {
            method: "PATCH",
            body: { density: p.density, timeRange: p.timeRange, sidebar: { collapsed: p.collapsed }, notificationPrefs: { minSeverity: p.minSeverity, muted: p.muted } },
          });
          if (p.density !== shell.prefs.density) shell.setDensity(p.density);
          if (p.collapsed !== shell.prefs.collapsed) shell.setCollapsed(p.collapsed);
          toast.success(t("admin.me.saved"));
          router.refresh();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.me.density")} htmlFor="pref-density" hint={t("admin.me.densityHint")}>
          <Select id="pref-density" value={p.density} onChange={(e) => setP({ ...p, density: e.target.value as Prefs["density"] })}>
            <option value="comfortable">{t("admin.me.comfortable")}</option>
            <option value="compact">{t("admin.me.compact")}</option>
          </Select>
        </Field>
        <Field label={t("admin.me.timeRange")} htmlFor="pref-range" hint={t("admin.me.timeRangeHint")}>
          <Select id="pref-range" value={p.timeRange} onChange={(e) => setP({ ...p, timeRange: e.target.value as Prefs["timeRange"] })}>
            {(["24h", "7d", "30d", "90d"] as const).map((r) => (
              <option key={r} value={r}>
                {t(`admin.overview.cc.ranges.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.me.sidebar")} htmlFor="pref-sidebar">
          <Select id="pref-sidebar" value={p.collapsed ? "collapsed" : "expanded"} onChange={(e) => setP({ ...p, collapsed: e.target.value === "collapsed" })}>
            <option value="expanded">{t("admin.me.sidebarExpanded")}</option>
            <option value="collapsed">{t("admin.me.sidebarCollapsed")}</option>
          </Select>
        </Field>
        <Field label={t("admin.me.minSeverity")} htmlFor="pref-severity" hint={t("admin.me.minSeverityHint")}>
          <Select id="pref-severity" value={p.minSeverity} onChange={(e) => setP({ ...p, minSeverity: e.target.value as Prefs["minSeverity"] })}>
            {(["INFO", "WARNING", "CRITICAL"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`admin.notifications.severity.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="grid gap-2" id="notifications">
        <legend className="text-[13px] font-medium">{t("admin.me.muted")}</legend>
        <p className="text-xs text-muted-foreground">{t("admin.me.mutedHint")}</p>
        {allTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("admin.me.noTypes")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allTypes.map((type) => (
              <label key={type} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs">
                <input type="checkbox" checked={p.muted.includes(type)} onChange={(e) => setP({ ...p, muted: e.target.checked ? [...p.muted, type] : p.muted.filter((m) => m !== type) })} className="size-3.5 accent-[var(--primary)]" />
                {type}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <FormError error={error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !dirty} aria-busy={busy}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

/** Clear recents and/or recent searches (own history only). */
export function ClearHistory() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/v1/admin/me/recents?what=all", { method: "DELETE" });
          toast.success(t("admin.me.historyCleared"));
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("admin.me.clearHistory")}
    </Button>
  );
}

/** Remove a favorite from the list on /me. */
export function FavoriteRemove({ href, name }: { href: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const shell = useShell();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        shell.toggleFavorite(href);
        router.refresh();
      }}
    >
      {t("admin.shell.unfavorite", { name })}
    </Button>
  );
}

/** Share / unshare or delete one of your saved views. */
export function SavedViewActions({ id, name, shared }: { id: string; name: string; shared: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const call = async (method: string, body?: unknown, ok?: string) => {
    setBusy(true);
    try {
      await api(`/api/v1/admin/me/saved-views/${id}`, { method, body });
      if (ok) toast.success(ok);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => call("PATCH", { shared: !shared })}>
        {shared ? t("admin.shell.views.unshare") : t("admin.shell.views.share")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          if (window.confirm(t("admin.shell.views.confirmDelete", { name }))) void call("DELETE", undefined, t("admin.shell.views.deleted", { name }));
        }}
      >
        {t("admin.shell.views.delete", { name })}
      </Button>
    </span>
  );
}
