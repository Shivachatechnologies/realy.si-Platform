import { Redis } from "ioredis";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { redisConfigured } from "@/server/core/rate-limit";
import type { OutboxEvent } from "@/server/modules/events/relay";

/**
 * Live-stream fan-out over Redis pub/sub. The worker's outbox relay publishes each relayed batch here, one message per
 * company (type, entity and a short label only — never the payload); every web process keeps ONE subscriber
 * connection and hands the messages to its open SSE connections for that company (voiceos/stream.ts). A message also
 * wakes those connections to re-read task / run / approval / call state at once, so they no longer poll the database
 * every 1.5 s. Without Redis, or while the subscriber is down, the stream falls back to polling as before.
 */

export const STREAM_CHANNEL = "realy:stream:v1";

export interface BusEvent {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  label: string | null;
  at: string;
}
export interface BusMessage {
  organizationId: string;
  companyId: string;
  events: BusEvent[];
}

export function labelOf(payload: unknown): string | null {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") return null;
  for (const k of ["title", "name", "subject", "number"]) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
  }
  return null;
}

/** Worker: publish a relayed outbox batch (company events only). Never throws: the stream's polling covers a miss. */
export async function publishStreamEvents(client: Pick<Redis, "publish">, events: OutboxEvent[]): Promise<number> {
  const byCompany = new Map<string, BusMessage>();
  for (const e of events) {
    if (!e.organizationId || !e.companyId) continue;
    const m = byCompany.get(e.companyId) ?? { organizationId: e.organizationId, companyId: e.companyId, events: [] };
    m.events.push({ id: e.id, type: e.type, aggregateType: e.aggregateType, aggregateId: e.aggregateId, label: labelOf(e.payload), at: new Date(e.occurredAt).toISOString() });
    byCompany.set(e.companyId, m);
  }
  let sent = 0;
  for (const m of byCompany.values()) {
    try {
      await client.publish(STREAM_CHANNEL, JSON.stringify(m));
      sent++;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "live stream publish failed");
    }
  }
  return sent;
}

type Listener = (m: BusMessage) => void;

interface Bus {
  sub: Redis;
  ready: boolean;
  listeners: Map<string, Set<Listener>>;
}

const g = globalThis as unknown as { realyStreamBus?: Bus | null };

function bus(): Bus | null {
  if (g.realyStreamBus !== undefined) return g.realyStreamBus;
  if (!redisConfigured()) return (g.realyStreamBus = null);
  try {
    const sub = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null, enableOfflineQueue: true });
    const b: Bus = { sub, ready: false, listeners: new Map() };
    sub.on("error", (err) => {
      b.ready = false;
      logger.warn({ err: err.message }, "live stream subscriber error");
    });
    sub.on("end", () => (b.ready = false));
    sub.on("close", () => (b.ready = false));
    // (Re)subscribe on every (re)connect; until then connections poll.
    sub.on("ready", () => {
      sub.subscribe(STREAM_CHANNEL).then(
        () => (b.ready = true),
        () => (b.ready = false),
      );
    });
    sub.on("message", (_channel: string, raw: string) => {
      let m: BusMessage;
      try {
        m = JSON.parse(raw) as BusMessage;
      } catch {
        return;
      }
      const set = b.listeners.get(m.companyId);
      if (set) for (const l of set) l(m);
    });
    g.realyStreamBus = b;
    return b;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "live stream subscriber unavailable");
    return (g.realyStreamBus = null);
  }
}

/** Is the pub/sub fan-out currently delivering (subscriber connected and subscribed)? */
export const busLive = () => !!bus()?.ready;

/** Listen for a company's relayed events. Returns the unsubscribe function. */
export function subscribeCompany(companyId: string, listener: Listener): () => void {
  const b = bus();
  if (!b) return () => undefined;
  const set = b.listeners.get(companyId) ?? new Set<Listener>();
  set.add(listener);
  b.listeners.set(companyId, set);
  return () => {
    set.delete(listener);
    if (!set.size) b.listeners.delete(companyId);
  };
}

/** Tests: close the subscriber. */
export async function closeStreamBus(): Promise<void> {
  const b = g.realyStreamBus;
  g.realyStreamBus = undefined;
  if (b) await b.sub.quit().catch(() => undefined);
}
