import { Mail, MessageCircle, MonitorSmartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { BriefingData } from "@/server/modules/briefing/types";

const ICON = { IN_APP: MonitorSmartphone, EMAIL: Mail, WHATSAPP: MessageCircle } as const;
const TONE = { SENT: "success", FAILED: "danger", NOT_CONFIGURED: "warning", SKIPPED: "neutral" } as const;

/** Newspaper-style masthead of one briefing: edition, date, period covered and what happened on each channel. */
export function ReportMasthead({ data, t, locale, deliveries }: { data: BriefingData; t: Translate; locale: string; deliveries: { channel: keyof typeof ICON; status: keyof typeof TONE; error: string | null }[] }) {
  const from = formatDate(data.period.from, locale, data.timezone, { dateStyle: "medium" });
  const to = formatDate(new Date(new Date(data.period.to).getTime() - 1), locale, data.timezone, { dateStyle: "medium" });
  return (
    <div className="grid gap-3 border-y py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-micro text-muted-foreground uppercase">{formatDate(data.generatedAt, locale, data.timezone, { dateStyle: "full" })}</p>
          <h2 className="font-display text-display-lg">{t(`briefing.kinds.${data.kind}`)}</h2>
          <p className="text-xs text-muted-foreground">{t("briefing.view.period", { from, to: data.kind === "EVENING" ? t("briefing.view.now") : to })}</p>
        </div>
        {deliveries.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("briefing.view.deliveries")}>
            {deliveries.map((d, i) => {
              const Icon = ICON[d.channel];
              return (
                <li key={i}>
                  <Badge tone={TONE[d.status]} shape="pill" title={d.error ?? undefined}>
                    <Icon className="size-3" aria-hidden />
                    {t(`briefing.channels.${d.channel}`)} · {t(`briefing.delivery.${d.status}`)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {deliveries.some((d) => d.status !== "SENT" && d.error) ? (
        <ul className="grid gap-0.5 text-xs text-muted-foreground">
          {deliveries
            .filter((d) => d.status !== "SENT" && d.error)
            .map((d, i) => (
              <li key={i}>
                {t(`briefing.channels.${d.channel}`)}: {t(`briefing.delivery.why.${d.status}`)}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
