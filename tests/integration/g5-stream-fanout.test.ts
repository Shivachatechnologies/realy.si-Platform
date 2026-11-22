import { afterAll, describe, expect, it } from "vitest";
import { redis } from "@/server/core/rate-limit";
import { busItems } from "@/server/modules/voiceos/stream";
import { busLive, closeStreamBus, publishStreamEvents, subscribeCompany, type BusMessage } from "@/server/modules/voiceos/stream-bus";

/**
 * B20 (G5): the worker's relay publishes outbox batches over Redis pub/sub (one message per company, no payloads), each
 * web process holds one subscriber and hands messages to that company's SSE connections, filtered by the viewer's
 * permissions. Requires the test Redis (REDIS_URL).
 */

const ORG = "0190a000-0000-7000-8000-000000000001";
const CO = "0190a000-0000-7000-8000-000000000002";
const OTHER = "0190a000-0000-7000-8000-000000000003";
const pub = redis();

afterAll(async () => {
  await closeStreamBus();
});

const until = async (ok: () => boolean, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return ok();
};

describe("live stream fan-out over Redis pub/sub", () => {
  it("delivers a company's relayed events to its subscribers only, without payloads", async () => {
    const got: BusMessage[] = [];
    const other: BusMessage[] = [];
    const off = subscribeCompany(CO, (m) => got.push(m));
    const offOther = subscribeCompany(OTHER, (m) => other.push(m));
    expect(await until(busLive)).toBe(true);
    const at = new Date();
    const sent = await publishStreamEvents(pub, [
      { id: "e1", type: "deal.won", version: 1, organizationId: ORG, companyId: CO, aggregateType: "deal", aggregateId: "d1", payload: { data: { title: "Big deal", secret: "x" } }, occurredAt: at },
      { id: "e2", type: "invoice.paid", version: 1, organizationId: ORG, companyId: CO, aggregateType: "invoice", aggregateId: "i1", payload: { data: { number: "INV-7" } }, occurredAt: at },
      { id: "e3", type: "org.updated", version: 1, organizationId: ORG, companyId: null, aggregateType: "organization", aggregateId: ORG, payload: {}, occurredAt: at },
    ] as never);
    expect(sent).toBe(1);
    expect(await until(() => got.length === 1)).toBe(true);
    expect(other).toHaveLength(0);
    expect(got[0]!.events.map((e) => e.label)).toEqual(["Big deal", "INV-7"]);
    expect(JSON.stringify(got[0])).not.toContain("secret");

    // Per-viewer filter: sales may see the deal, not the invoice (finance).
    const access = { scope: { organizationId: ORG, companyId: CO }, chain: [] as never, userId: "u", perms: new Set(["sales.read"]) };
    expect(busItems(access as never, got[0]!).map((i) => i.type)).toEqual(["deal.won"]);
    // Another tenant's message is never shown.
    expect(busItems({ ...access, scope: { organizationId: ORG, companyId: OTHER } } as never, got[0]!)).toEqual([]);
    off();
    offOther();
  });
});
