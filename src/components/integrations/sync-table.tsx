import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Translate } from "@/i18n/translate";
import { formatDateTime } from "@/i18n/format";

export const SYNC_TONE = { RUNNING: "accent", SUCCEEDED: "success", PARTIAL: "warning", FAILED: "danger" } as const;

export interface SyncRow {
  id: string;
  provider: string;
  kind: string;
  trigger: string;
  status: keyof typeof SYNC_TONE;
  itemsRead: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  errorCount: number;
  errors: unknown;
  startedAt: Date;
  finishedAt: Date | null;
}

/** Sync history table (server component). */
export function SyncTable({ rows, t, locale, tz, showProvider }: { rows: SyncRow[]; t: Translate; locale: string; tz: string; showProvider?: boolean }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{t("integrations.syncs.started")}</Th>
          {showProvider ? <Th>{t("integrations.syncs.provider")}</Th> : null}
          <Th>{t("integrations.syncs.kind")}</Th>
          <Th>{t("common.status")}</Th>
          <Th className="text-end">{t("integrations.syncs.read")}</Th>
          <Th className="text-end">{t("integrations.syncs.created")}</Th>
          <Th className="text-end">{t("integrations.syncs.updated")}</Th>
          <Th className="text-end">{t("integrations.syncs.skipped")}</Th>
          <Th>{t("integrations.syncs.errors")}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => {
          const errors = Array.isArray(r.errors) ? (r.errors as { message: string; ref?: string }[]) : [];
          return (
            <Tr key={r.id}>
              <Td className="whitespace-nowrap">
                {formatDateTime(r.startedAt, locale, tz)}
                <span className="ms-1 text-xs text-muted-foreground">({t(`integrations.syncs.trigger_${r.trigger === "scheduled" ? "scheduled" : r.trigger === "manual" ? "manual" : "external"}`)})</span>
              </Td>
              {showProvider ? <Td>{r.provider}</Td> : null}
              <Td className="font-mono text-xs">{r.kind}</Td>
              <Td>
                <Badge tone={SYNC_TONE[r.status]}>{t(`integrations.syncStatus.${r.status}`)}</Badge>
              </Td>
              <Td className="text-end tabular-nums">{r.itemsRead}</Td>
              <Td className="text-end tabular-nums">{r.itemsCreated}</Td>
              <Td className="text-end tabular-nums">{r.itemsUpdated}</Td>
              <Td className="text-end tabular-nums">{r.itemsSkipped}</Td>
              <Td className="max-w-80">
                {errors.length ? (
                  <details>
                    <summary className="cursor-pointer text-danger">{t("integrations.syncs.errorCount", { count: r.errorCount })}</summary>
                    <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
                      {errors.slice(0, 10).map((e, i) => (
                        <li key={i} className="break-words">
                          {e.ref ? <span className="font-mono">{e.ref}: </span> : null}
                          {e.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
