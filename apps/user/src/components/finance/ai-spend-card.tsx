import "server-only";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { AiSpendView } from "@/server/modules/finance/ai-costs";
import type { Translate } from "@/i18n/translate";
import { Empty, Kpi } from "./widgets";

/** Micro-USD → US cents (for formatMoney). */
export const usdCents = (micros: bigint) => (micros + 5_000n) / 10_000n;

/**
 * AI and provider spend from the cost ledger, next to the book figures. Added to profit, burn and runway only when the
 * company keeps its books in USD (the ledger's currency); otherwise shown separately and never converted.
 */
export function AiSpendCard({ ai, t, locale, money }: { ai: AiSpendView; t: Translate; locale: string; money: (v: bigint | string, cur?: string) => string }) {
  const usd = (micros: bigint) => money(usdCents(micros), "USD");
  return (
    <Card>
      <CardHeader
        icon={<Bot />}
        title={t("finance.aiSpend.title")}
        description={t("finance.aiSpend.hint")}
        actions={
          <Link href={`/${locale}/costs`} className="text-xs hover:underline">
            {t("finance.aiSpend.openCosts")}
          </Link>
        }
      />
      <CardBody className="grid gap-3">
        {!ai.recorded ? (
          <Empty>{t("finance.aiSpend.empty")}</Empty>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi label={t("finance.aiSpend.period")} value={usd(ai.micros)} hint={t("finance.aiSpend.estimated", { amount: usd(ai.estimatedMicros) })} />
              <Kpi label={t("finance.aiSpend.monthly")} value={usd(ai.monthlyBurnMicros)} hint={t("finance.aiSpend.monthlyHint")} />
              {ai.comparable ? (
                <>
                  <Kpi label={t("finance.aiSpend.profitAfter")} value={ai.profitAfterAi !== null ? money(ai.profitAfterAi) : "—"} tone={ai.profitAfterAi !== null && ai.profitAfterAi < 0n ? "danger" : undefined} />
                  <Kpi label={t("finance.aiSpend.burnWith")} value={ai.netBurnWithAi !== null ? money(ai.netBurnWithAi) : "—"} />
                  <Kpi label={t("finance.aiSpend.runwayWith")} value={ai.runwayWithAiMonths === null ? t("finance.dashboard.noBurn") : t("finance.dashboard.months", { count: ai.runwayWithAiMonths })} tone={ai.runwayWithAiMonths !== null && ai.runwayWithAiMonths < 6 ? "danger" : undefined} />
                </>
              ) : null}
            </div>
            {!ai.comparable ? <p className="text-xs text-muted-foreground">{t("finance.aiSpend.notConverted")}</p> : null}
            {ai.byCategory.length ? (
              <ul className="flex flex-wrap gap-2 text-xs" aria-label={t("finance.aiSpend.byCategory")}>
                {ai.byCategory.slice(0, 8).map((c) => (
                  <li key={c.key} className="rounded-md border px-2 py-1">
                    <span className="text-muted-foreground">{t(`finance.aiSpend.categories.${c.key}`)}</span> <span className="tabular-nums">{usd(c.micros)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              <Link href={`/${locale}/finance/roi`} className="hover:underline">
                {t("finance.aiSpend.roiLink")}
              </Link>
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
