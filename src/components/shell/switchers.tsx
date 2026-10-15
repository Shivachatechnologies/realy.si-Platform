"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { api, setCookie } from "@/lib/api-client";

const ORG_COOKIE = "realy_org";
const COMPANY_COOKIE = "realy_company";

export function ContextSwitcher({
  orgs,
  orgId,
  companies,
  companyId,
}: {
  orgs: { id: string; name: string }[];
  orgId: string;
  companies: { id: string; name: string }[];
  companyId: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (cookie: string, value: string, resetCompany = false) => {
    setCookie(cookie, value);
    if (resetCompany) setCookie(COMPANY_COOKIE, "", 0);
    start(() => router.refresh());
  };
  const cls = "h-8 min-w-0 max-w-44 truncate rounded-md border bg-surface px-2 text-xs disabled:opacity-60";
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label className="sr-only" htmlFor="org-switch">{t("common.organization")}</label>
      <select id="org-switch" className={cls} value={orgId} disabled={pending} onChange={(e) => pick(ORG_COOKIE, e.target.value, true)}>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {companies.length > 0 ? (
        <>
          <span className="text-muted-foreground" aria-hidden>/</span>
          <label className="sr-only" htmlFor="company-switch">{t("common.company")}</label>
          <select id="company-switch" className={cls} value={companyId ?? ""} disabled={pending} onChange={(e) => pick(COMPANY_COOKIE, e.target.value)}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}

export function SignOutButton() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await api("/api/v1/auth/sign-out", { method: "POST" }).catch(() => undefined);
          router.replace(`/${locale}/sign-in`);
          router.refresh();
        })
      }
      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={t("common.signOut")}
      title={t("common.signOut")}
    >
      <LogOut className="size-4 rtl:-scale-x-100" />
    </button>
  );
}
