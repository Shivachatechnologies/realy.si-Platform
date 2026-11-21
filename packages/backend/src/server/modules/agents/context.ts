import { createHash } from "node:crypto";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { searchDocuments } from "@/server/modules/brain/service";
import { classifyTool } from "@/server/modules/workforce/autonomy-classes";
import { getTool, type Citable } from "@/server/modules/tools/registry";

/**
 * Context manager of the agents runtime:
 *  - relevant-context selection: the Company Brain passages most relevant to the task, packed into a token budget
 *    and registered as citable sources up front (saves a search round-trip; the principal's brain.read applies);
 *  - request deduplication: an identical read-only request (same company, role, prompt, tools and task text) within
 *    the TTL reuses the stored result instead of paying for the same work again;
 *  - stored summaries of long histories come from server-side compaction (runtime.ts → AgentContextSummary).
 */

const log = logger.child({ component: "agent-context" });

/** Rough token estimate (4 characters per token) for budgeting — never billed by. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export const CONTEXT_BUDGET = { simple: 800, standard: 2000, complex: 4000 } as const;

/**
 * Up to `tokenBudget` tokens of the best-matching document passages for the task, formatted with citation refs.
 * Empty when the principal may not read the brain, nothing matches, or search is unavailable.
 */
export async function selectRelevantContext(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  query: string,
  tokenBudget: number,
  cite: (c: Citable) => string,
): Promise<string> {
  const q = query
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (!q || tokenBudget <= 0) return "";
  try {
    const { results } = await searchDocuments(ctx, organizationId, companyId, { q, limit: 6 });
    if (!results.length) return "";
    const chunks = await db().brainChunk.findMany({ where: { id: { in: results.map((r) => r.passageId) }, organizationId, companyId }, select: { id: true, text: true } });
    const text = new Map(chunks.map((c) => [c.id, c.text]));
    const parts: string[] = [];
    let used = 0;
    for (const r of results) {
      const body = text.get(r.passageId) ?? r.snippet.map((s) => s.text).join("");
      const cost = estimateTokens(body) + 20;
      if (used + cost > tokenBudget) continue;
      const ref = cite({ passageId: r.passageId, documentId: r.citation.documentId, title: r.citation.title, passage: r.citation.passage });
      parts.push(`[${ref}] ${r.citation.title} — passage ${r.citation.passage}\n${body}`);
      used += cost;
    }
    return parts.length ? `\n\nPossibly relevant company documents (found for this task; cite with their reference, search for more if needed):\n\n${parts.join("\n\n---\n\n")}` : "";
  } catch {
    return "";
  }
}

// ───────────── Deduplication of identical read-only requests ─────────────

export const DEDUP_TTL_MS = 10 * 60_000;

/** True when every offered tool only reads (so repeating the run cannot have side effects worth repeating). */
export function readOnlyTools(tools: readonly string[]): boolean {
  return tools.every((name) => {
    const t = getTool(name);
    return !!t && t.autonomy === "AUTONOMOUS" && classifyTool(t) === "read";
  });
}

export const requestKey = (parts: Record<string, unknown>) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export interface CachedRun {
  output: string;
  citations: unknown[];
  toolCalls: unknown[];
  model: string;
  taskId: string | null;
}

export async function cachedRun(companyId: string, keyHash: string): Promise<CachedRun | null> {
  try {
    const row = await db().agentRequestCache.findUnique({ where: { companyId_keyHash: { companyId, keyHash } } });
    if (!row || row.expiresAt < new Date()) return null;
    await db().agentRequestCache.update({ where: { id: row.id }, data: { hits: { increment: 1 } } }).catch(() => undefined);
    return row.result as unknown as CachedRun;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "request cache unavailable");
    return null;
  }
}

export async function storeRun(scope: { organizationId: string; companyId: string }, keyHash: string, run: CachedRun) {
  const data = { taskId: run.taskId, model: run.model, result: run as unknown as Prisma.InputJsonValue, hits: 0, expiresAt: new Date(Date.now() + DEDUP_TTL_MS) };
  await db()
    .agentRequestCache.upsert({ where: { companyId_keyHash: { companyId: scope.companyId, keyHash } }, create: { ...scope, keyHash, ...data }, update: data })
    .catch((err) => log.warn({ err: err instanceof Error ? err.message : String(err) }, "request cache not stored"));
}

/** Persist a compaction summary of a long history (best effort). */
export async function storeContextSummary(scope: { organizationId: string; companyId: string }, taskId: string | null, model: string, summary: string, inputTokens: number | null) {
  if (!taskId || !summary.trim()) return;
  await db()
    .agentContextSummary.create({ data: { ...scope, taskId, model, summary: summary.slice(0, 100_000), inputTokens } })
    .catch((err) => log.warn({ err: err instanceof Error ? err.message : String(err) }, "context summary not stored"));
}
