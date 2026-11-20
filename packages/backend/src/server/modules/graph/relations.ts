import type { GraphEntityKind, GraphRelation } from "@/generated/prisma/enums";

export const ENTITY_KINDS = ["PERSON", "TEAM", "PRODUCT", "CUSTOMER", "VENDOR", "PARTNER"] as const satisfies readonly GraphEntityKind[];

/** Typed relations: which entity kinds each relation may connect (from → to). Shared by the API and the UI. */
export const RELATIONS = {
  MEMBER_OF: { from: ["PERSON"], to: ["TEAM"] },
  REPORTS_TO: { from: ["PERSON"], to: ["PERSON"] },
  OWNS: { from: ["PERSON", "TEAM"], to: ["PRODUCT"] },
  WORKS_ON: { from: ["PERSON", "TEAM"], to: ["PRODUCT"] },
  USES: { from: ["CUSTOMER"], to: ["PRODUCT"] },
  SUPPLIES: { from: ["VENDOR"], to: ["PRODUCT", "TEAM"] },
  PARTNERS_ON: { from: ["PARTNER"], to: ["PRODUCT"] },
  MANAGES_ACCOUNT: { from: ["PERSON", "TEAM"], to: ["CUSTOMER", "VENDOR", "PARTNER"] },
} as const satisfies Record<GraphRelation, { from: readonly GraphEntityKind[]; to: readonly GraphEntityKind[] }>;

export const RELATION_KEYS = Object.keys(RELATIONS) as [GraphRelation, ...GraphRelation[]];

export const relationAllowed = (relation: GraphRelation, from: GraphEntityKind, to: GraphEntityKind) =>
  (RELATIONS[relation].from as readonly GraphEntityKind[]).includes(from) && (RELATIONS[relation].to as readonly GraphEntityKind[]).includes(to);
