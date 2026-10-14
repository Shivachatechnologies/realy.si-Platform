"use client";

import { useI18n } from "@/i18n/client";
import { Notice } from "@/components/ui/notice";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocationSearch } from "@/lib/use-location-search";

/** Brand names are product names (data), not translatable copy. */
const PROVIDER_NAMES: Record<string, string> = { google: "Google", github: "GitHub", microsoft: "Microsoft" };

export interface ProviderStatus {
  id: string;
  configured: boolean;
}

/** Sign-in buttons. Unconfigured providers are shown disabled with a truthful "not configured" label. */
export function OAuthButtons({ providers, mode = "login", linked = [] }: { providers: ProviderStatus[]; mode?: "login" | "link"; linked?: string[] }) {
  const { t, locale } = useI18n();
  const search = useLocationSearch();
  const next = new URLSearchParams(search).get("next");
  return (
    <div className="grid gap-2">
      {providers.map((p) => {
        const name = PROVIDER_NAMES[p.id] ?? p.id;
        if (linked.includes(p.id)) {
          return (
            <div key={p.id} className="flex h-9 items-center justify-between rounded-md border px-3 text-sm">
              <span>{name}</span>
              <span className="text-xs text-success">{t("settings.security.connectedAs")}</span>
            </div>
          );
        }
        if (!p.configured) {
          return (
            <button key={p.id} type="button" disabled className={cn(buttonVariants({ variant: "secondary" }), "justify-between")}>
              <span>{name}</span>
              <span className="text-xs font-normal text-muted-foreground">{t("auth.oauthNotConfigured")}</span>
            </button>
          );
        }
        const params = new URLSearchParams({ locale, mode, ...(next ? { next } : {}) });
        return (
          <a key={p.id} href={`/api/v1/auth/oauth/${p.id}/start?${params}`} className={cn(buttonVariants({ variant: "secondary" }), "justify-between")}>
            <span>{name}</span>
            {mode === "link" ? <span className="text-xs font-normal text-muted-foreground">{t("settings.security.connect")}</span> : null}
          </a>
        );
      })}
    </div>
  );
}

const KNOWN_ERRORS = new Set(["account_exists", "email_unverified", "state_mismatch", "provider_error", "already_linked", "not_configured", "account_disabled"]);

export function OAuthErrorNotice() {
  const { t } = useI18n();
  const search = new URLSearchParams(useLocationSearch());
  const code = search.get("oauthError");
  if (!code || !KNOWN_ERRORS.has(code)) return null;
  const provider = PROVIDER_NAMES[search.get("provider") ?? ""] ?? "";
  return <Notice tone="danger">{t(`auth.oauthErrors.${code}`, { provider })}</Notice>;
}
