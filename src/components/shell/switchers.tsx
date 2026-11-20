"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { DropdownMenu as M } from "radix-ui";
import { Building2, ChevronsUpDown, LogOut, Network, Settings } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { api, setCookie } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const ORG_COOKIE = "realy_org";
const COMPANY_COOKIE = "realy_company";

/** A native select dressed as a context pill: keeps native keyboard/screen-reader behaviour and RTL. */
function ContextSelect({
  id,
  label,
  icon: Icon,
  value,
  disabled,
  options,
  onChange,
  className,
}: {
  id: string;
  label: string;
  icon: typeof Building2;
  value: string;
  disabled: boolean;
  options: { id: string; name: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "group relative inline-flex h-8 min-w-0 max-w-28 pointer-coarse:h-10 sm:max-w-48 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs transition-colors hover:border-border hover:bg-surface/80 focus-within:border-ring has-disabled:opacity-60",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground max-sm:hidden" aria-hidden />
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent pe-4 font-medium text-foreground focus-visible:outline-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute end-1.5 size-3 text-muted-foreground" aria-hidden />
    </span>
  );
}

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
  return (
    <div className="flex min-w-0 items-center gap-0.5" aria-busy={pending || undefined}>
      <ContextSelect
        id="org-switch"
        label={t("common.organization")}
        icon={Network}
        value={orgId}
        disabled={pending}
        options={orgs}
        onChange={(v) => pick(ORG_COOKIE, v, true)}
      />
      {companies.length > 0 ? (
        <>
          <span className="text-border-strong" aria-hidden>
            /
          </span>
          <ContextSelect
            id="company-switch"
            label={t("common.company")}
            icon={Building2}
            value={companyId ?? ""}
            disabled={pending}
            options={companies}
            onChange={(v) => pick(COMPANY_COOKIE, v)}
          />
        </>
      ) : null}
      {pending ? <span className="ms-1 live-dot text-primary" data-pulse="true" aria-hidden /> : null}
    </div>
  );
}

function useSignOut(to: "sign-in" | "admin/login") {
  const { locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const signOut = () =>
    start(async () => {
      await api("/api/v1/auth/sign-out", { method: "POST" }).catch(() => undefined);
      router.replace(`/${locale}/${to}`);
      router.refresh();
    });
  return { pending, signOut };
}

/** `to`: where to land after signing out (the admin console returns to its own login page). */
export function SignOutButton({ to = "sign-in" }: { to?: "sign-in" | "admin/login" }) {
  const { t } = useI18n();
  const { pending, signOut } = useSignOut(to);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={signOut}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 pointer-coarse:p-3"
      aria-label={t("common.signOut")}
      title={t("common.signOut")}
    >
      <LogOut className="size-4 rtl:-scale-x-100" />
    </button>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => Array.from(p)[0]!.toUpperCase())
    .join("") || "?";

/** Avatar button with the account menu: identity, settings, sign out. */
export function UserMenu({ name, email, to = "sign-in", settingsHref = "/settings" }: { name: string; email: string; to?: "sign-in" | "admin/login"; settingsHref?: string | null }) {
  const { t, locale } = useI18n();
  const { pending, signOut } = useSignOut(to);
  const item =
    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:min-h-11 text-sm text-foreground outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50";
  return (
    <M.Root>
      <M.Trigger
        className="press grid size-8 shrink-0 place-items-center rounded-full pointer-coarse:size-10 bg-brand-gradient text-[11px] font-semibold text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.25)] ring-2 ring-surface transition-shadow hover:shadow-glow data-[state=open]:shadow-glow"
        aria-label={t("shell.userMenu")}
        title={name}
      >
        <span aria-hidden>{initials(name)}</span>
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={8}
          className="glass-strong z-50 w-60 rounded-lg border p-1.5 shadow-elev-4 data-[state=open]:animate-scale-in"
        >
          <div className="px-2 py-1.5">
            <p className="text-[11px] text-muted-foreground">{t("shell.signedInAs")}</p>
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted-foreground" dir="ltr">
              {email}
            </p>
          </div>
          <M.Separator className="my-1 h-px bg-border" />
          {settingsHref ? (
            <M.Item asChild className={item}>
              <Link href={`/${locale}${settingsHref}`}>
                <Settings className="size-4 text-muted-foreground" aria-hidden />
                {t("nav.settings")}
              </Link>
            </M.Item>
          ) : null}
          <M.Item className={item} disabled={pending} onSelect={(e) => {
              e.preventDefault();
              signOut();
            }}>
            <LogOut className="size-4 text-muted-foreground rtl:-scale-x-100" aria-hidden />
            {t("common.signOut")}
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
