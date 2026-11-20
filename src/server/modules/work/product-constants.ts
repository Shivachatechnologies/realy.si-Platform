import type { ProductDocKind, ProductStage } from "@/generated/prisma/enums";

/** Product constants without imports of services (safe for module-level use in tool definitions). */

/** Lifecycle pipeline, in order. */
export const PRODUCT_STAGES = [
  "IDEA",
  "RESEARCH",
  "VALIDATION",
  "BUSINESS_REQUIREMENTS",
  "PRODUCT_REQUIREMENTS",
  "ARCHITECTURE",
  "DESIGN",
  "DEVELOPMENT",
  "QA",
  "RELEASE",
  "LAUNCH",
  "FEEDBACK",
  "OPTIMIZATION",
] as const satisfies readonly ProductStage[];

export const DOC_KINDS = ["RESEARCH", "BRD", "PRD", "TECH_REQUIREMENTS", "ARCHITECTURE", "UX_SPEC", "DESIGN_BRIEF", "QA_PLAN", "RELEASE_PLAN"] as const satisfies readonly ProductDocKind[];
