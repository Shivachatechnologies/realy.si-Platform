"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/client";
import { Button } from "@/components/ui/button";

/**
 * Cookie notice (not a consent wall). Realy sets only strictly necessary and preference cookies — the session cookie,
 * short-lived sign-in state for OAuth/SSO, the chosen language and the selected organization/company — and loads no
 * analytics, advertising or tracking scripts (docs: /legal/cookies). Under the ePrivacy rules those need no consent,
 * so this is an informational, dismissable notice. The dismissal is kept in localStorage (no extra cookie).
 * If analytics or marketing scripts are ever added, replace this with opt-in consent that gates them.
 */
const KEY = "realy_cookie_notice";
const EVENT = "realy-cookie-notice";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "dismissed";
  } catch {
    return false; // storage blocked: show the notice (dismissal then lasts for this page only)
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

let dismissedThisPage = false;

export function CookieNotice() {
  const { t, locale } = useI18n();
  // Server render and hydration: hidden (no flash, no hydration mismatch); the client then reads the stored choice.
  const dismissed = useSyncExternalStore(subscribe, () => dismissedThisPage || read(), () => true);
  if (dismissed) return null;
  const dismiss = () => {
    dismissedThisPage = true;
    try {
      window.localStorage.setItem(KEY, "dismissed");
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return (
    <div
      role="region"
      aria-label={t("legal.cookieNotice.label")}
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-xl items-start gap-3 rounded-xl border bg-surface/95 p-3 text-[13px] leading-relaxed shadow-elev-3 backdrop-blur sm:inset-x-auto sm:end-4 sm:mx-0"
    >
      <p className="flex-1 text-muted-foreground">
        {t("legal.cookieNotice.text")}{" "}
        <Link href={`/${locale}/legal/cookies`} className="font-medium text-primary underline underline-offset-4">
          {t("legal.cookieNotice.link")}
        </Link>
      </p>
      <Button size="sm" variant="secondary" onClick={dismiss}>
        {t("legal.cookieNotice.ok")}
      </Button>
    </div>
  );
}
