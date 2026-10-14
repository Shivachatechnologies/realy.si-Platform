import type { z } from "zod";
import type { Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { toJson } from "@/server/core/json";
import { eventCatalog, type EventPayload, type EventType } from "./catalog";

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
