BEGIN;

-- CreateTable
CREATE TABLE "platform_secrets" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value_encrypted" TEXT NOT NULL,
    "last4" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_secrets_key_key" ON "platform_secrets"("key");


COMMIT;
