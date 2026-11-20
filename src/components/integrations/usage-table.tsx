import Link from "next/link";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatNumber } from "@/i18n/format";
import { providerInfo } from "@/server/modules/integrations/catalog";
import type { usageSummary } from "@/server/modules/integrations/service";
import { formatCostMicros } from "./usage-format";

type Summary = Awaited<ReturnType<typeof usageSummary>>;
type T = (key: string, vars?: Record<string, string | number>) => string;

/** Usage per provider and operation (calls, failures, units, estimated cost). */
export function UsageSummaryTable({ summary, t, locale, showProvider }: { summary: Summary; t: T; locale: string; showProvider?: boolean }) {
  const rows = summary.providers.flatMap((p) => p.operations.map((o) => ({ provider: p.provider, ...o })));
  return (
    <Table>
      <THead>
        <Tr>
          {showProvider ? <Th>{t("integrations.usage.provider")}</Th> : null}
          <Th>{t("integrations.usage.operation")}</Th>
          <Th className="text-end">{t("integrations.usage.calls")}</Th>
          <Th className="text-end">{t("integrations.usage.failed")}</Th>
          <Th className="text-end">{t("integrations.usage.units")}</Th>
          <Th className="text-end">{t("integrations.usage.estimatedCost")}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={`${r.provider}:${r.operation}`}>
            {showProvider ? (
              <Td>
                <Link href={`/${locale}/integrations/${r.provider}/usage`} className="font-medium hover:underline">
                  {providerInfo(r.provider)?.name ?? r.provider}
                </Link>
              </Td>
            ) : null}
            <Td>{t(`integrations.usage.operations.${r.operation.replace(".", "_")}`)}</Td>
            <Td className="text-end tabular-nums">{formatNumber(r.calls, locale)}</Td>
            <Td className={`text-end tabular-nums ${r.failed ? "text-danger" : ""}`}>{formatNumber(r.failed, locale)}</Td>
            <Td className="text-end tabular-nums">
              {formatNumber(r.units, locale)} <span className="text-xs text-muted-foreground">{t(`integrations.usage.unitNames.${r.unit}`)}</span>
            </Td>
            <Td className="text-end tabular-nums">{formatCostMicros(r.costMicros, locale)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
