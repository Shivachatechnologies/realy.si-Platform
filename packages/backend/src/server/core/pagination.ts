import { z } from "zod";

export const pageInput = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});
export type PageInput = z.infer<typeof pageInput>;

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Cursor pagination over UUIDv7 ids (time-ordered). Use with `take: limit + 1`. */
export function prismaPage(p: PageInput) {
  return {
    take: p.limit + 1,
    ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
  };
}

export function toPage<T extends { id: string }>(rows: T[], p: PageInput): Page<T> {
  const hasMore = rows.length > p.limit;
  const data = hasMore ? rows.slice(0, p.limit) : rows;
  return { data, nextCursor: hasMore ? data[data.length - 1]!.id : null };
}
