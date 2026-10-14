"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type AppLocale } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { api, setCookie } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Switch UI language: remembers the choice (cookie + profile when signed in) and swaps the URL prefix. */
export function LanguageSwitcher({ signedIn = false, className }: { signedIn?: boolean; className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  function change(next: AppLocale) {
    setCookie(LOCALE_COOKIE, next);
    start(async () => {
      if (signedIn) await api("/api/v1/me", { method: "PATCH", body: { locale: next } }).catch(() => undefined);
      router.replace(pathname.replace(/^\/[^/]+/, `/${next}`));
    });
  }

  return (
    <span className={cn("relative inline-flex items-center gap-1.5 text-muted-foreground", className)}>
      <Languages className="size-4" aria-hidden />
      <select
        aria-label={t("common.language")}
        value={locale}
        disabled={pending}
        onChange={(e) => change(e.target.value as AppLocale)}
        className="cursor-pointer appearance-none bg-transparent pe-1 text-xs hover:text-foreground focus-visible:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </span>
  );
}
