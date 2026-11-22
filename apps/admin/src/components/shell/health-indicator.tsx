import Link from "next/link";
import { Activity, Siren } from "lucide-react";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";

/**
 * Top-bar platform status: core checks (database, Redis; cached 30 s) and the incident indicator. Incidents are not
 * tracked yet (stream E adds platform_incidents); the indicator says so instead of claiming "no incidents".
 */
export async function HealthIndicator({ base, health }: { base: string; health: { database: boolean; redis: boolean } | null }) {
  const t = await getT();
  if (!health) return null;
  const down = !health.database || !health.redis;
  const label = down ? t("admin.shell.status.degraded") : t("admin.shell.status.operational");
  return (
    <span className="hidden items-center gap-1 lg:inline-flex">
      <Link
        href={`${base}/system`}
        title={`${t("admin.health.database")}: ${health.database ? t("admin.overview.check.ok") : t("admin.overview.check.down")} · ${t("admin.health.redis")}: ${health.redis ? t("admin.overview.check.ok") : t("admin.overview.check.down")}`}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium focus-visible:outline-2",
          down ? "border-danger/40 bg-danger/10 text-danger" : "border-success/30 bg-success/8 text-success",
        )}
      >
        <Activity className="size-3" aria-hidden />
        {label}
      </Link>
      <span title={t("admin.shell.status.incidentsNotTracked")} className="inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] text-muted-foreground">
        <Siren className="size-3" aria-hidden />
        <span className="sr-only">{t("admin.shell.status.incidentsNotTracked")}</span>
        <span aria-hidden>—</span>
      </span>
    </span>
  );
}
