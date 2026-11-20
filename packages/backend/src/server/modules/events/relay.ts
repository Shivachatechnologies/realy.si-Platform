import { db } from "@/server/core/db";

export interface OutboxEvent {
  id: string;
  type: string;
  version: number;
  organizationId: string | null;
  companyId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  occurredAt: Date;
}

export type Publisher = (events: OutboxEvent[]) => Promise<void>;

/**
 * Publish one batch of unpublished outbox events. Rows are claimed with FOR UPDATE SKIP LOCKED so
 * several relay workers can run concurrently without double-claiming. Delivery is at-least-once:
 * if publish succeeds but the commit fails, the batch is re-published (consumers dedupe by id).
 */
export async function relayBatch(publish: Publisher, batchSize = 500): Promise<number> {
  const result = await db().$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          type: string;
          version: number;
          organization_id: string | null;
          company_id: string | null;
          aggregate_type: string;
          aggregate_id: string;
          payload: unknown;
          occurred_at: Date;
        }[]
      >`SELECT id, type, version, organization_id, company_id, aggregate_type, aggregate_id, payload, occurred_at
        FROM events WHERE published_at IS NULL
        ORDER BY occurred_at, id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return { count: 0, error: null };
      const events: OutboxEvent[] = rows.map((r) => ({
        id: r.id,
        type: r.type,
        version: r.version,
        organizationId: r.organization_id,
        companyId: r.company_id,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        payload: r.payload,
        occurredAt: r.occurred_at,
      }));
      const ids = events.map((e) => e.id);
      try {
        await publish(events);
      } catch (err) {
        // Commit the failure bookkeeping (events stay unpublished), then surface the error.
        await tx.event.updateMany({
          where: { id: { in: ids } },
          data: { attempts: { increment: 1 }, lastError: String(err).slice(0, 1000) },
        });
        return { count: 0, error: err };
      }
      await tx.event.updateMany({ where: { id: { in: ids } }, data: { publishedAt: new Date(), lastError: null } });
      return { count: events.length, error: null };
    },
    { timeout: 30_000 },
  );
  if (result.error) throw result.error;
  return result.count;
}
