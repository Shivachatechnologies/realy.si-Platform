import type { ModuleJobs } from "@/server/core/module-jobs";
import { indexModuleSources } from "./sources";

/**
 * Background work of the Company Brain module (register BRAIN_JOBS in src/worker/modules.ts):
 * - Module knowledge ingestion: published support KB articles, HR policies, operations SOPs and product
 *   releases/features are indexed as Brain documents, re-indexed when they change and removed when unpublished.
 */
export const BRAIN_JOBS: ModuleJobs = {
  periodic: [{ name: "brain.index_module_sources", everyMs: 10 * 60_000, run: indexModuleSources }],
  onEvent: [],
};
