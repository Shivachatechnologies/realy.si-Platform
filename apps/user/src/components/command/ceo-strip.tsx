import Link from "next/link";
import { ArrowUpRight, Crown, Gavel } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/i18n/format";
import type { ceoSnapshot } from "@/server/modules/guide/ceo";
import { describePriority } from "./ceo-describe";

type Snapshot = NonNullable<Awaited<ReturnType<typeof ceoSnapshot>>>;
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Command Center: what the AI CEO is driving this week (real priorities, run states and open decisions). */
export function CeoStrip({ t, locale, data }: { t: Translate; locale: string; data: Snapshot }) {
  return (
    <section aria-labelledby="ceo-strip-title" className="panel-float grid gap-3 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Crown className="size-4 text-primary" aria-hidden />
        <h2 id="ceo-strip-title" className="text-sm font-semibold">
          {t("command.ceo.strip.title")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {!data.ceo
            ? t("command.ceo.strip.noCeo")
            : data.cycle
              ? t("command.ceo.strip.last", { when: formatRelativeTime(data.cycle.at, locale), count: data.cycle.delegated })
              : t("command.ceo.review.never")}
        </span>
        <Link href={`/${locale}/command/ceo`} className="ms-auto inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
          {t("command.ceo.open")} <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
        </Link>
      </header>
      {data.priorities.length ? (
        <ol className="grid gap-2 md:grid-cols-3">
          {data.priorities.map((p, i) => (
            <li key={p.id} className="grid gap-1 rounded-xl border bg-surface p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("command.ceo.strip.priority", { n: i + 1 })}</span>
              <span className="text-sm font-medium">{describePriority(t, locale, p).title}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {t(`profiles.${p.profile}.name`)}
                {p.runStatus ? <Badge tone={p.runStatus === "COMPLETED" ? "success" : p.runStatus === "FAILED" ? "danger" : "info"}>{t(`command.ai.runStatus.${p.runStatus}`)}</Badge> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : data.ceo ? (
        <p className="text-sm text-muted-foreground">{t("command.ceo.priorities.noneYet")}</p>
      ) : null}
      {data.openDecisions ? (
        <Link href={`/${locale}/command/ceo`} className="inline-flex items-center gap-1.5 text-sm font-medium text-warning hover:underline">
          <Gavel className="size-4" aria-hidden />
          {t("command.ceo.strip.decisions", { count: data.openDecisions })}
        </Link>
      ) : null}
    </section>
  );
}
