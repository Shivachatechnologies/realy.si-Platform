"use client";

import Link from "next/link";
import { useEffect } from "react";
import { OctagonAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/admin/copy-button";
import { useI18n } from "@/i18n/client";

/**
 * Console-wide error boundary (stream A): the shell stays usable; the page shows what failed, a retry, the error
 * reference to quote to engineering (the server log carries the same digest) and a way back. Server error messages
 * are never shown in production (Next.js replaces them with the digest).
 */
export default function ConsoleError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t, locale } = useI18n();
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="grid justify-items-center gap-3 rounded-xl border bg-surface px-6 py-12 text-center shadow-elev-1">
      <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-danger/10 text-danger">
        <OctagonAlert className="size-5" />
      </span>
      <h1 className="text-base font-semibold">{t("admin.shell.error.title")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("admin.shell.error.body")}</p>
      {digest ? (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {t("admin.shell.error.reference")} <CopyButton value={digest} showValue label={t("admin.shell.error.reference")} />
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={() => retry()}>
          <RotateCcw aria-hidden />
          {t("admin.shell.retry")}
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href={`/${locale}`}>{t("admin.shell.error.home")}</Link>
        </Button>
      </div>
    </div>
  );
}
