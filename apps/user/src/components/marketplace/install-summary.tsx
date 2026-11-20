"use client";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/client";
import type { InstallSummary } from "@/server/modules/marketplace/install";
import { SECTION_KEYS } from "./shared";

/** What an install or upgrade created, skipped (existing names / missing permission) and left pending (module bridges). */
export function InstallSummaryList({ summary }: { summary: InstallSummary }) {
  const t = useT();
  const rows = SECTION_KEYS.filter((k) => summary[k]);
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t("marketplace.summary.nothing")}</p>;
  return (
    <ul className="grid gap-1.5 text-sm">
      {rows.map((k) => {
        const s = summary[k]!;
        return (
          <li key={k} className="flex flex-wrap items-center gap-2">
            <span className="min-w-32 font-medium">{t(`marketplace.sections.${k.replace(/^_/, "")}`)}</span>
            {s.forbidden ? (
              <Badge tone="warning">
                {t("marketplace.summary.forbidden", {
                  permission: s.forbidden,
                })}
              </Badge>
            ) : s.pending ? (
              <Badge tone="warning">{t("marketplace.summary.pending")}</Badge>
            ) : (
              <>
                <Badge tone={s.created ? "success" : "neutral"}>{t("marketplace.summary.created", { count: s.created })}</Badge>
                {s.skipped ? <Badge>{t("marketplace.summary.skipped", { count: s.skipped })}</Badge> : null}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
