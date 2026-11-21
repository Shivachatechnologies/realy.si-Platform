"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Ends the Control Center session (admin cookie only; a user-app session elsewhere is unaffected). */
export function SignOutButton() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const signOut = () =>
    start(async () => {
      await api("/api/v1/auth/sign-out", { method: "POST" }).catch(() => undefined);
      router.replace(`/${locale}/login`);
      router.refresh();
    });
  return (
    <button
      type="button"
      disabled={pending}
      onClick={signOut}
      className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
      aria-label={t("common.signOut")}
      title={t("common.signOut")}
    >
      <LogOut className="size-4 rtl:-scale-x-100" />
    </button>
  );
}
