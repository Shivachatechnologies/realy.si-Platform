-- Phase 2: Company Brain (documents, passages, full-text search). Atomic, see 20261015120000_checkout_sessions.
BEGIN;

-- CreateEnum
CREATE TYPE "BrainDocumentStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "brain_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "status" "BrainDocumentStatus" NOT NULL DEFAULT 'PROCESSING',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brain_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_chunks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "start_offset" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "brain_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brain_documents_organization_id_company_id_created_at_idx" ON "brain_documents"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "brain_documents_id_company_id_key" ON "brain_documents"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "brain_documents_company_id_content_sha256_key" ON "brain_documents"("company_id", "content_sha256");

-- CreateIndex
CREATE INDEX "brain_chunks_company_id_idx" ON "brain_chunks"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "brain_chunks_document_id_ordinal_key" ON "brain_chunks"("document_id", "ordinal");

-- AddForeignKey
ALTER TABLE "brain_documents" ADD CONSTRAINT "brain_documents_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_chunks" ADD CONSTRAINT "brain_chunks_document_id_company_id_fkey" FOREIGN KEY ("document_id", "company_id") REFERENCES "brain_documents"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Full-text search over passages (english config: stemming + stop words; other languages match on exact tokens).
CREATE INDEX "brain_chunks_search_idx" ON "brain_chunks" USING GIN (to_tsvector('english', "text"));

-- Invariants the application also enforces.
ALTER TABLE "brain_documents" ADD CONSTRAINT "brain_documents_title_not_blank" CHECK (length(btrim("title")) BETWEEN 1 AND 200);
ALTER TABLE "brain_documents" ADD CONSTRAINT "brain_documents_size_positive" CHECK ("size_bytes" > 0);
ALTER TABLE "brain_chunks" ADD CONSTRAINT "brain_chunks_text_not_blank" CHECK (length(btrim("text")) > 0);

COMMIT;
