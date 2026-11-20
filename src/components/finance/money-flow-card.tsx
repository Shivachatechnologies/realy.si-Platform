import "server-only";
import Link from "next/link";
import { Waypoints } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Translate } from "@/i18n/translate";
import type { RequestContext } from "@/server/core/context";
import type { DateRange } from "@/server/modules/finance/common";
import { moneyFlow } from "@/server/modules/finance/money-flow";
import { MoneyFlow, type FlowItem } from "./money-flow";

/** Card with the money-flow diagram for a period (P&L figures from the ledger). */
export async function MoneyFlowCard({
  ctx,
  organizationId,
  companyId,
  range,
  t,
  locale,
  money,
  qs,
}: {
  ctx: RequestContext;
  organizationId: string;
  companyId: string;
  range: DateRange;
  t: Translate;
  locale: string;
  money: (v: bigint) => string;
  qs: string;
}) {
  const f = await moneyFlow(ctx, organizationId, companyId, range);
  const scale = Number(f.scale) || 1;
  const item = (n: (typeof f.sources)[number]): FlowItem => ({
    key: n.key,
    kind: n.kind,
    label: n.label ?? t(`finance.flow.${n.kind}`),
    amount: money(n.amountMinor),
    value: Number(n.amountMinor) / scale,
    href: n.kind === "income" || n.kind === "expense" ? `/${locale}/finance/accounting/ledger/${n.key}?${qs}` : undefined,
  });
  return (
    <Card>
      <CardHeader
        icon={<Waypoints />}
        title={t("finance.flow.title")}
        description={t("finance.flow.hint")}
        actions={
          <Link href={`/${locale}/finance/learn#pnl`} className="text-xs text-muted-foreground hover:underline">
            {t("finance.flow.whatIsThis")}
          </Link>
        }
      />
      <CardBody>
        <MoneyFlow
          title={t("finance.flow.aria", { income: money(f.totalIncome), expenses: money(f.totalExpense) })}
          sources={f.sources.map(item)}
          uses={f.uses.map(item)}
          centerLabel={t("finance.flow.center")}
          centerAmount={f.net >= 0n ? t("finance.flow.kept", { amount: money(f.net) }) : t("finance.flow.lost", { amount: money(-f.net) })}
          emptyText={t("finance.flow.empty")}
          legend={{ in: t("finance.flow.moneyIn"), out: t("finance.flow.moneyOut") }}
        />
      </CardBody>
    </Card>
  );
}
