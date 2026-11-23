"use client";

import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { Building2, FileText, KeyRound, Megaphone, Plus, Shield, Tag } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { useShell } from "./shell-context";

/**
 * "Create" quick menu: links to the page where each thing is created (that page's own dialog does the work, with its
 * reason and audit). Entries the admin cannot open are hidden; the target page and API still enforce.
 */
const ITEMS = [
  { id: "org", label: "admin.shell.create.organization", href: "/organizations", icon: Building2, perms: ["platform.organizations.manage"] },
  { id: "role", label: "admin.shell.create.role", href: "/roles", icon: Shield, perms: ["platform.security.manage", "platform.roles.manage"] },
  { id: "plan", label: "admin.shell.create.plan", href: "/plans", icon: Tag, perms: ["pricing.manage"] },
  { id: "page", label: "admin.shell.create.page", href: "/cms", icon: FileText, perms: ["platform.content.manage"] },
  { id: "announcement", label: "admin.shell.create.announcement", href: "/announcements", icon: Megaphone, perms: ["platform.controls.manage", "platform.content.manage"] },
  { id: "key", label: "admin.shell.create.key", href: "/keys", icon: KeyRound, perms: ["platform.controls.manage", "platform.security.manage"] },
] as const;

export function CreateMenu() {
  const { t, locale } = useI18n();
  const { can } = useShell();
  const items = ITEMS.filter((i) => can(i.perms));
  if (!items.length) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={t("admin.shell.create.title")} title={t("admin.shell.create.title")} className="grid size-8 place-items-center rounded-md border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground focus-visible:outline-2">
          <Plus className="size-4" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-52 rounded-lg border bg-surface p-1 shadow-elev-3 data-[state=open]:animate-scale-in">
          <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("admin.shell.create.title")}</DropdownMenu.Label>
          {items.map((i) => (
            <DropdownMenu.Item key={i.id} asChild>
              <Link href={`/${locale}${i.href}`} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground">
                <i.icon className="size-3.5 text-muted-foreground" aria-hidden />
                {t(i.label)}
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
