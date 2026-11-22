-- CreateEnum
CREATE TYPE "CrmReplyClass" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'REFERRAL', 'QUESTION', 'OTHER');

-- AlterEnum
ALTER TYPE "SupportChannel" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "crm_cadence_enrollments" ADD COLUMN     "reply_class" "CrmReplyClass",
ADD COLUMN     "reply_classified_at" TIMESTAMPTZ(3),
ADD COLUMN     "reply_resume_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "crm_deals" ADD COLUMN     "predicted_at" TIMESTAMPTZ(3),
ADD COLUMN     "predicted_factors" JSONB,
ADD COLUMN     "predicted_probability" INTEGER;

-- AlterTable
ALTER TABLE "crm_prospect_people" ADD COLUMN     "reply_class" "CrmReplyClass",
ADD COLUMN     "reply_classified_at" TIMESTAMPTZ(3),
ADD COLUMN     "reply_resume_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "support_messages" ADD COLUMN     "external_message_id" TEXT;

-- AlterTable
ALTER TABLE "support_settings" ADD COLUMN     "email_channel_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "whatsapp_channel_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "external_thread_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_company_id_external_message_id_key" ON "support_messages"("company_id", "external_message_id");

-- CreateIndex
CREATE INDEX "support_tickets_company_id_external_thread_key_idx" ON "support_tickets"("company_id", "external_thread_key");

