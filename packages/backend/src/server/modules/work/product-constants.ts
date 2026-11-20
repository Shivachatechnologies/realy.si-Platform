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

export const DOC_KINDS = ["RESEARCH", "BRD", "PRD", "TECH_REQUIREMENTS", "ARCHITECTURE", "UX_SPEC", "DESIGN_BRIEF", "QA_PLAN", "RELEASE_PLAN", "IDEA_BRIEF", "VALIDATION_REPORT", "LAUNCH_BRIEF", "FEEDBACK_SYNTHESIS", "IMPROVEMENT_PLAN"] as const satisfies readonly ProductDocKind[];

/**
 * Saved deliverables each lifecycle stage produces (product documents). The stage gate can only be approved once every
 * deliverable of the stage has at least one saved version; Development's deliverable is the backlog in its project.
 */
export const STAGE_DELIVERABLES: Record<ProductStage, ProductDocKind[]> = {
  IDEA: ["IDEA_BRIEF"],
  RESEARCH: ["RESEARCH"],
  VALIDATION: ["VALIDATION_REPORT"],
  BUSINESS_REQUIREMENTS: ["BRD"],
  PRODUCT_REQUIREMENTS: ["PRD"],
  ARCHITECTURE: ["ARCHITECTURE", "TECH_REQUIREMENTS"],
  DESIGN: ["UX_SPEC", "DESIGN_BRIEF"],
  DEVELOPMENT: [],
  QA: ["QA_PLAN"],
  RELEASE: ["RELEASE_PLAN"],
  LAUNCH: ["LAUNCH_BRIEF"],
  FEEDBACK: ["FEEDBACK_SYNTHESIS"],
  OPTIMIZATION: ["IMPROVEMENT_PLAN"],
};
