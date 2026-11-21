import type { ModuleJobs } from "@/server/core/module-jobs";
import { reindexEmbeddings } from "./embeddings";
import { applyRetention, rollupDepartments } from "./memory-store";
import { indexModuleSources } from "./sources";

/**
 * Background work of the Company Brain module (register BRAIN_JOBS in src/worker/modules.ts):
 * - Module knowledge ingestion: published support KB articles, HR policies, operations SOPs and product
 *   releases/features are indexed as Brain documents, re-indexed when they change and removed when unpublished.
 * - Incremental re-embedding (only with a connected embedding provider and pgvector; otherwise a no-op): new passages
 *   (with overlap) and new/edited memories get vectors; vectors of deleted text are swept.
 * - Retention: memories and uploaded documents past their expiry or their layer's retention are deleted (audited).
 * - Weekly department digest of the facts recorded last week (idempotent per department and week).
 */
export const BRAIN_JOBS: ModuleJobs = {
  periodic: [
    { name: "brain.index_module_sources", everyMs: 10 * 60_000, run: indexModuleSources },
    { name: "brain.embeddings_reindex", everyMs: 5 * 60_000, run: reindexEmbeddings },
    { name: "brain.memory_retention", everyMs: 60 * 60_000, run: applyRetention },
    { name: "brain.department_rollup", everyMs: 6 * 60 * 60_000, run: rollupDepartments },
  ],
  onEvent: [],
};
