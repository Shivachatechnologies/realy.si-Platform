# Shared company memory (Company Brain)

Code: `packages/backend/src/server/modules/brain/` — `memory-policy.ts` (layers, scopes, read rules),
`memory.ts` (facts CRUD, prompt memory), `memory-store.ts` (remember / summarize / forget, retention, document
governance, export, weekly digest), `embeddings.ts` (optional semantic layer), `context.ts` (`selectContext`).
UI: `/brain/memory`, document governance on `/brain/[documentId]`.

## Model

One store, `company_memories` (`CompanyMemory`), for every layer: `COMPANY, KNOWLEDGE, PRODUCT, BRAND, CUSTOMER,
DEPARTMENT, EMPLOYEE, TASK, CONVERSATION` (documents are `brain_documents` + `brain_chunks`, layer `DOCUMENT`).
Each row has a **scope** (`COMPANY | DEPARTMENT | EMPLOYEE | TASK` with `departmentId` / `aiEmployeeId` / `taskId`),
an optional customer subject (`account` / `contact`), `sourceKind`, `sensitivity`, `readPermission`, `expiresAt`
and a `dedupKey` (same fact, same owner → one row). Documents get the same governance through
`brain_document_policies`. Retention per layer: `brain_retention_policies` (defaults: conversation 180 d, task 365 d).

Read rule (every query, on top of `brain.read` and organizationId + companyId): explicit `readPermission` must be
held; finance / HR / payroll department knowledge needs `finance.read` / `hr.read` / `payroll.read`; `RESTRICTED`
needs `brain.manage`; expired rows are never returned. Vectors never bypass this: semantic hits are hydrated through
the same filters.

## Agents runtime

```ts
import { selectContext } from "@/server/modules/brain/context";
import { rememberFact, summarizeConversation, forget } from "@/server/modules/brain/memory-store";

const c = await selectContext(ctx, organizationId, companyId, { query: `${title}\n${instructions}`, tokenBudget: 2000, employeeId, taskId });
// c.text → system prompt block ("" when nothing); c.citations → [{ ref: "C1", type, id, href, documentId?, passage? }]
await rememberFact(ctx, organizationId, companyId, { fact, scope: "EMPLOYEE", layer: "EMPLOYEE", employeeId, taskId }, { author: "AI" });
await summarizeConversation(ctx, organizationId, companyId, { conversationRef: taskId, taskId, employeeId, summary /* or messages */ });
```

`selectContext` never throws (no access / failure → empty selection). AI writes to company/department scope are
refused unless `{ approved: true }` (the approval flow ran).

## Database requirements (migration)

Full-text search (always on) — expression GIN index:

```sql
CREATE INDEX IF NOT EXISTS company_memories_fts ON company_memories USING gin (to_tsvector('simple', title || ' ' || fact));
```

Semantic search (optional) needs pgvector **before** the `brain_embeddings` migration:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE INDEX IF NOT EXISTS brain_embeddings_hnsw ON brain_embeddings USING hnsw (embedding vector_cosine_ops);
```

If the database cannot install pgvector, remove the `embedding vector(1536)` column from the generated migration.
`embeddings.ts` checks for the extension and the column (cached 5 min) and falls back to full-text search only;
the UI says "Keyword only" and why.

## Embedding providers

Connected per company in Integrations, tried in order: OpenAI (`text-embedding-3-small`, 1536), Gemini
(`gemini-embedding-001`, 1536), Voyage (`voyage-3.5`, 1024 zero-padded). Only vectors of the same model are compared;
switching provider re-embeds and then drops the old model's vectors. Calls go through `providerFetch` and are metered
with `recordUsage`. Voyage needs a `voyage` entry in `integrations/catalog.ts` (+ connection test and i18n) before
companies can connect it.

## Jobs (`BRAIN_JOBS`)

`brain.embeddings_reindex` (5 min: new passages with 300-char overlap from the previous passage, new/edited memories,
orphan sweep), `brain.memory_retention` (hourly), `brain.department_rollup` (weekly digest per department, idempotent
per week; AI-written via the company's OpenAI/Gemini when connected, else a plain list of fact titles).
