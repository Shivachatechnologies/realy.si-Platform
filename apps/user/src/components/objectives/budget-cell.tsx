import { Badge } from "@/components/ui/badge";
import { formatMoney, formatNumber } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { BudgetStatus } from "@/server/modules/objectives/budgets";
import { ProgressBar } from "./progress";

/**
 * Budget vs actual of a goal or initiative (B15). Actual is the real AI and provider spend of its work (cost ledger,
 * USD); a percentage is shown only when the budget is in USD, otherwise both amounts side by side.
 */
export function BudgetCell({ status, locale, t }: { status: BudgetStatus; locale: string; t: Translate }) {
  const actual = formatMoney({ amountMinor: BigInt(Math.round(status.actual.micros / 10_000)), currency: "USD" }, locale);
  if (!status.budget) {
    return status.actual.micros > 0 ? <span className="text-muted-foreground">{t("objectives.budget.spentNoBudget", { actual })}</span> : <span className="text-muted-foreground">—</span>;
  }
  const budget = formatMoney({ amountMinor: status.budget.amountMinor, currency: status.budget.currency }, locale);
  return (
    <div className="grid gap-1">
      <span className="tabular">{t("objectives.budget.of", { actual, budget })}</span>
      {status.usedPct !== null ? (
        <>
          <ProgressBar value={Math.min(status.usedPct / 100, 1)} label={t("objectives.budget.column")} />
          {status.over ? <Badge tone="danger">{t("objectives.budget.over", { pct: formatNumber(status.usedPct, locale) })}</Badge> : null}
        </>
      ) : (
        <span className="text-[11px] text-muted-foreground">{t("objectives.budget.otherCurrency")}</span>
      )}
    </div>
  );
}
