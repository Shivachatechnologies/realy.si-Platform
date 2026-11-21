import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { env } from "./env";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

const globalForDb = globalThis as unknown as { realyDb?: PrismaClient };

function create(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL, max: 10 });
  return new PrismaClient({ adapter });
}

/** Process-wide Prisma client (pooled). Reused across hot reloads in development. */
export function db(): PrismaClient {
  if (!globalForDb.realyDb) globalForDb.realyDb = create();
  return globalForDb.realyDb;
}

/** Run `fn` in one transaction. Audit rows and outbox events written with `tx` commit atomically with the change. */
export function transaction<T>(
  fn: (tx: Tx) => Promise<T>,
  opts?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
): Promise<T> {
  return db().$transaction(fn, { timeout: opts?.timeout ?? 15_000, isolationLevel: opts?.isolationLevel });
}

export { Prisma };
