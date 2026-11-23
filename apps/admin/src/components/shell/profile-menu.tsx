"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { DropdownMenu } from "radix-ui";
import { Bell, Keyboard, LogOut, Rows3, UserCog } from "lucide-react";
import { Avatar } from "@/components/admin/avatar";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useShell } from "./shell-context";

const item = "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

/** Profile menu: who is signed in (name, email, platform roles), personal preferences, compact mode and sign out. */
export function ProfileMenu({ name, email, roles }: { name: string; email: string; roles: string[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const shell = useShell();
  const [pending, start] = useTransition();
  const signOut = () =>
    start(async () => {
      await api("/api/v1/auth/sign-out", { method: "POST" }).catch(() => undefined);
      router.replace(`/${locale}/login`);
      router.refresh();
    });
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={t("admin.shell.profile", { name })} className="flex items-center gap-2 rounded-full p-0.5 hover:bg-muted focus-visible:outline-2">
          <Avatar name={name} size="sm" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-64 rounded-lg border bg-surface p-1 shadow-elev-3 data-[state=open]:animate-scale-in">
          <div className="px-2 py-2">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{email}</div>
            {roles.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {roles.map((r) => (
                  <span key={r} className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {r}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild>
            <Link href={`/${locale}/me`} className={item}>
              <UserCog className="size-3.5 text-muted-foreground" aria-hidden />
              {t("admin.nav.me")}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href={`/${locale}/notifications`} className={item}>
              <Bell className="size-3.5 text-muted-foreground" aria-hidden />
              {t("admin.nav.notifications")}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.CheckboxItem checked={shell.prefs.density === "compact"} onCheckedChange={(c) => shell.setDensity(c ? "compact" : "comfortable")} className={item}>
            <Rows3 className="size-3.5 text-muted-foreground" aria-hidden />
            {t("admin.me.compact")}
            <DropdownMenu.ItemIndicator className="ms-auto text-xs text-primary">✓</DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Item className={item} onSelect={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}>
            <Keyboard className="size-3.5 text-muted-foreground" aria-hidden />
            {t("admin.palette.ctx.shortcuts")}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={item} disabled={pending} onSelect={signOut}>
            <LogOut className="size-3.5 text-muted-foreground rtl:-scale-x-100" aria-hidden />
            {t("common.signOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
