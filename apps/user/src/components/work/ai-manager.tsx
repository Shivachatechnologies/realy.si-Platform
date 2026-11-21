import Link from "next/link";
import { Bot, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Translate } from "@/i18n/translate";

/**
 * Who runs this department: the hired AI employee (name, autonomy, what it does on its own schedule) or a call to hire
 * one in the AI workforce. Shared by Finance, HR, Projects, Operations and Support desks.
 */
export function AiManagerStrip({ t, locale, manager, duty }: { t: Translate; locale: string; manager: { name: string; autonomy: string } | null; duty: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface-2/60 p-3 text-sm">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-primary-foreground [&_svg]:size-4">
        <Bot />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        {manager ? (
          <>
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {t("work.aiManager.runBy", { name: manager.name })}
              <Badge tone="brand" shape="pill">
                {t(`work.aiManager.autonomy.${manager.autonomy}`)}
              </Badge>
            </p>
            <p className="text-xs text-muted-foreground">{duty}</p>
          </>
        ) : (
          <>
            <p className="font-medium">{t("work.aiManager.none")}</p>
            <p className="text-xs text-muted-foreground">{t("work.aiManager.noneHint", { duty })}</p>
          </>
        )}
      </div>
      {manager ? null : (
        <Link href={`/${locale}/workforce`} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-muted px-3 text-sm font-medium hover:bg-muted/70">
          <UserPlus aria-hidden className="size-4" />
          {t("work.aiManager.hire")}
        </Link>
      )}
    </div>
  );
}
