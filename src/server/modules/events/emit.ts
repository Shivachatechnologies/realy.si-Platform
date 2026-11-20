import type { z } from "zod";
import type { Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { toJson } from "@/server/core/json";
import { eventCatalog, type DomainEventType, type EventPayload, type EventType } from "./catalog";

export interface EmitOptions {
  organizationId?: string | null;
  companyId?: string | null;
  aggregateType: string;
  aggregateId: string;
}

/**
 * Write a domain event to the transactional outbox. It becomes visible to the relay only if
 * the surrounding transaction commits, so events never describe changes that rolled back.
 */
export async function emitEvent<T extends EventType>(
  tx: Tx,
  ctx: RequestContext,
  type: T,
  payload: EventPayload<T>,
  opts: EmitOptions,
): Promise<string> {
  const version = 1;
  const schema = (eventCatalog[type] as Record<number, z.ZodType>)[version];
  if (!schema) throw new Error(`Unregistered event ${type}@${version}`);
  const parsed = schema.parse(payload);
  const row = await tx.event.create({
    data: {
      type,
      version,
      organizationId: opts.organizationId ?? null,
      companyId: opts.companyId ?? null,
      aggregateType: opts.aggregateType,
      aggregateId: opts.aggregateId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      requestId: ctx.requestId,
      payload: toJson(parsed),
    },
    select: { id: true },
  });
  return row.id;
}

type Scalar = string | number | boolean | null;

/**
 * Emit a business-module event (catalog DOMAIN_EVENTS) inside the caller's transaction. `data` is a flat snapshot of the
 * record that workflow conditions can test; Dates become ISO strings, bigints become strings, undefined is dropped.
 */
export async function emitDomainEvent(
  tx: Tx,
  ctx: RequestContext,
  type: DomainEventType,
  args: { organizationId: string; companyId: string; entityType: string; entityId: string; data?: Record<string, Scalar | Date | bigint | undefined> },
): Promise<string> {
  const data: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(args.data ?? {})) {
    if (v === undefined) continue;
    data[k] = v instanceof Date ? v.toISOString() : typeof v === "bigint" ? v.toString() : v;
  }
  return emitEvent(tx, ctx, type, { companyId: args.companyId, entityId: args.entityId, data }, {
    organizationId: args.organizationId,
    companyId: args.companyId,
    aggregateType: args.entityType,
    aggregateId: args.entityId,
  });
}
