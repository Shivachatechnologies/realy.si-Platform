-- Phase 2: Company Graph (entities + typed relations). Atomic, see 20261015120000_checkout_sessions.
BEGIN;

-- CreateEnum
CREATE TYPE "GraphEntityKind" AS ENUM ('PERSON', 'TEAM', 'PRODUCT', 'CUSTOMER', 'VENDOR', 'PARTNER');

-- CreateEnum
CREATE TYPE "GraphRelation" AS ENUM ('MEMBER_OF', 'REPORTS_TO', 'OWNS', 'WORKS_ON', 'USES', 'SUPPLIES', 'PARTNERS_ON', 'MANAGES_ACCOUNT');

-- CreateTable
CREATE TABLE "graph_entities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "GraphEntityKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "graph_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_edges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "relation" "GraphRelation" NOT NULL,
    "to_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "graph_entities_organization_id_company_id_idx" ON "graph_entities"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "graph_entities_id_company_id_key" ON "graph_entities"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "graph_entities_company_id_kind_name_key" ON "graph_entities"("company_id", "kind", "name");

-- CreateIndex
CREATE INDEX "graph_edges_company_id_to_id_idx" ON "graph_edges"("company_id", "to_id");

-- CreateIndex
CREATE UNIQUE INDEX "graph_edges_from_id_relation_to_id_key" ON "graph_edges"("from_id", "relation", "to_id");

-- AddForeignKey
ALTER TABLE "graph_entities" ADD CONSTRAINT "graph_entities_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_from_id_company_id_fkey" FOREIGN KEY ("from_id", "company_id") REFERENCES "graph_entities"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_to_id_company_id_fkey" FOREIGN KEY ("to_id", "company_id") REFERENCES "graph_entities"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants the application also enforces.
ALTER TABLE "graph_entities" ADD CONSTRAINT "graph_entities_name_not_blank" CHECK (length(btrim("name")) BETWEEN 1 AND 160);
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_no_self_loop" CHECK ("from_id" <> "to_id");

COMMIT;
