import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Translate } from "@/i18n/translate";
import { formatDateTime } from "@/i18n/format";
import { formatDuration, isLive, OUTCOME_TONE, SENTIMENT_TONE, STATUS_TONE } from "./bits";

export interface CallRow {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  toNumber: string;
  fromNumber: string | null;
  subjectName: string | null;
  outcome: string | null;
  sentiment: string | null;
  durationSec: number | null;
  summary: string | null;
  scheduledFor: Date | null;
  createdAt: Date;
  blockedReason: string | null;
  agent: { id: string; name: string } | null;
  campaign?: { id: string; name: string } | null;
}

/** Calls list (server component): who, agent, status, outcome, sentiment, duration and when. */
export function CallsTable({ rows, t, locale, tz }: { rows: CallRow[]; t: Translate; locale: string; tz: string }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{t("voice.calls.person")}</Th>
          <Th className="hidden md:table-cell">{t("voice.calls.agent")}</Th>
          <Th>{t("voice.calls.status")}</Th>
          <Th className="hidden sm:table-cell">{t("voice.calls.outcome")}</Th>
          <Th className="hidden lg:table-cell">{t("voice.calls.duration")}</Th>
          <Th className="hidden md:table-cell">{t("voice.calls.when")}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((c) => {
          const number = c.direction === "INBOUND" ? c.fromNumber : c.toNumber;
          return (
            <Tr key={c.id}>
              <Td>
                <Link href={`/${locale}/voice/calls/${c.id}`} className="grid min-w-0 gap-0.5 hover:underline">
                  <span className="flex items-center gap-1.5 font-medium">
                    {c.direction === "INBOUND" ? <ArrowDownLeft aria-label={t("voice.direction.INBOUND")} className="size-3.5 text-info" /> : <ArrowUpRight aria-label={t("voice.direction.OUTBOUND")} className="size-3.5 text-primary" />}
                    <span className="truncate">{c.subjectName ?? number ?? t("voice.calls.unknown")}</span>
                  </span>
                  {c.summary ? <span className="line-clamp-1 text-xs text-muted-foreground">{c.summary}</span> : c.campaign ? <span className="text-xs text-muted-foreground">{c.campaign.name}</span> : <span className="font-mono text-xs text-muted-foreground">{number}</span>}
                </Link>
              </Td>
              <Td className="hidden md:table-cell">{c.agent?.name ?? "—"}</Td>
              <Td>
                <Badge tone={STATUS_TONE[c.status] ?? "neutral"} pulse={isLive(c.status)}>
                  {t(`voice.status.${c.status}`)}
                </Badge>
                {c.status === "SCHEDULED" && c.scheduledFor ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatDateTime(c.scheduledFor, locale, tz)}</span> : null}
                {c.blockedReason && (c.status === "BLOCKED" || c.status === "CANCELLED" || c.status === "REJECTED") ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{t(`voice.blocked.${c.blockedReason}`)}</span> : null}
              </Td>
              <Td className="hidden sm:table-cell">
                <span className="flex flex-wrap items-center gap-1">
                  {c.outcome ? <Badge tone={OUTCOME_TONE[c.outcome] ?? "neutral"}>{t(`voice.outcomes.${c.outcome}`)}</Badge> : "—"}
                  {c.sentiment && c.sentiment !== "UNKNOWN" ? <Badge tone={SENTIMENT_TONE[c.sentiment] ?? "neutral"}>{t(`voice.sentiment.${c.sentiment}`)}</Badge> : null}
                </span>
              </Td>
              <Td className="hidden tabular-nums lg:table-cell">{c.durationSec ? formatDuration(c.durationSec) : "—"}</Td>
              <Td className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">{formatDateTime(c.createdAt, locale, tz)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
