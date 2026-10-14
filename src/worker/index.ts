/**
 * Realy worker process (docs/architecture.md §2). Same codebase as the web app, separate entrypoint:
 *   pnpm worker
 * Phase 1 runs the outbox relay; workflow, agent and ingestion processors attach here in later phases.
 */
import "dotenv/config";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { relayBatch } from "@/server/modules/events/relay";
import { db } from "@/server/core/db";

const POLL_MS = 500;
let stopping = false;

async function main() {
  const connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue("events", { connection });
  const log = logger.child({ component: "outbox-relay" });
  log.info("worker started");

  const publish = async (events: Awaited<Parameters<Parameters<typeof relayBatch>[0]>[0]>) => {
    // Job id = event id → BullMQ dedupes re-published events.
    await queue.addBulk(
      events.map((e) => ({
        name: e.type,
        data: { ...e, occurredAt: e.occurredAt.toISOString() },
        opts: { jobId: e.id, removeOnComplete: 10_000, removeOnFail: 50_000, attempts: 10, backoff: { type: "exponential", delay: 1000 } },
      })),
    );
  };

  while (!stopping) {
    try {
      const n = await relayBatch(publish);
      if (n > 0) log.info({ published: n }, "relayed events");
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      log.error({ err }, "relay batch failed");
      await new Promise((r) => setTimeout(r, POLL_MS * 4));
    }
  }
  await queue.close();
  await connection.quit();
  await db().$disconnect();
  log.info("worker stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
  });
}

main().catch((err) => {
  logger.fatal({ err }, "worker crashed");
  process.exit(1);
});
