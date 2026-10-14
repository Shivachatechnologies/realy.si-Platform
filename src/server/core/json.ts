import type { Prisma } from "@/generated/prisma/client";

/**
 * Convert a value to JSON-safe data: bigint → string, Date → ISO string.
 * Used for API responses, audit diffs and event payloads.
 */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
