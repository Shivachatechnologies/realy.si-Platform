import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";

/** Minimal public layout (help center, ticket page, support form): company name, language switcher. */
export function PublicShell({ title, home, children, footer }: { title: string; home?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        {home ? (
          <Link href={home} className="truncate font-semibold tracking-tight">
            {title}
          </Link>
        ) : (
          <span className="truncate font-semibold tracking-tight">{title}</span>
        )}
        <LanguageSwitcher />
      </header>
      <main className="mx-auto grid max-w-3xl gap-6 px-4 pt-8 pb-16">{children}</main>
      {footer ? <footer className="pb-8 text-center text-xs text-muted-foreground">{footer}</footer> : null}
    </div>
  );
}
