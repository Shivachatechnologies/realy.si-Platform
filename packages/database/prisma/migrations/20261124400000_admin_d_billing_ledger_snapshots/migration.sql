-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "subscription_id" UUID,
    "stripe_invoice_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "number" TEXT,
    "status" TEXT NOT NULL,
    "billing_reason" TEXT,
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_known" BOOLEAN NOT NULL DEFAULT false,
    "total_minor" BIGINT NOT NULL,
    "amount_paid_minor" BIGINT NOT NULL DEFAULT 0,
    "amount_due_minor" BIGINT NOT NULL DEFAULT 0,
    "amount_remaining_minor" BIGINT NOT NULL DEFAULT 0,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "due_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "hosted_url" TEXT,
    "pdf_url" TEXT,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "stripe_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "stripe_customer_id" TEXT,
    "stripe_invoice_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_charge_id" TEXT,
    "status" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "refunded_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "payment_method_type" TEXT,
    "payment_method_brand" TEXT,
    "last4" TEXT,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "stripe_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID,
    "organization_id" UUID,
    "stripe_refund_id" TEXT NOT NULL,
    "stripe_charge_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "failure_reason" TEXT,
    "created_by_id" UUID,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "stripe_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_disputes" (
    "id" UUID NOT NULL,
    "payment_id" UUID,
    "organization_id" UUID,
    "stripe_dispute_id" TEXT NOT NULL,
    "stripe_charge_id" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidence_due_by" TIMESTAMPTZ(3),
    "is_charge_refundable" BOOLEAN NOT NULL DEFAULT false,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "stripe_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mrr_snapshots" (
    "day" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "mrr_minor" BIGINT NOT NULL,
    "new_minor" BIGINT NOT NULL DEFAULT 0,
    "expansion_minor" BIGINT NOT NULL DEFAULT 0,
    "contraction_minor" BIGINT NOT NULL DEFAULT 0,
    "churn_minor" BIGINT NOT NULL DEFAULT 0,
    "reactivation_minor" BIGINT NOT NULL DEFAULT 0,
    "active_subs" INTEGER NOT NULL,
    "trialing_subs" INTEGER NOT NULL,
    "past_due_subs" INTEGER NOT NULL DEFAULT 0,
    "paying_orgs" INTEGER NOT NULL DEFAULT 0,
    "new_orgs" INTEGER NOT NULL DEFAULT 0,
    "churned_orgs" INTEGER NOT NULL DEFAULT 0,
    "baseline" BOOLEAN NOT NULL DEFAULT false,
    "by_plan" JSONB NOT NULL DEFAULT '{}',
    "org_mrr" JSONB NOT NULL DEFAULT '{}',
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mrr_snapshots_pkey" PRIMARY KEY ("day","currency")
);

-- CreateTable
CREATE TABLE "platform_daily_metrics" (
    "day" DATE NOT NULL,
    "key" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_daily_metrics_pkey" PRIMARY KEY ("day","key")
);

-- CreateTable
CREATE TABLE "credit_ledger_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID,
    "meter" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" BIGINT NOT NULL,
    "period_key" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "source_type" TEXT,
    "source_id" TEXT,
    "reason" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "limit_key" TEXT NOT NULL,
    "used" BIGINT NOT NULL,
    "limit" BIGINT,
    "increment" BIGINT NOT NULL DEFAULT 1,
    "blocked" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_stripe_invoice_id_key" ON "platform_invoices"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "platform_invoices_organization_id_created_at_idx" ON "platform_invoices"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_invoices_status_created_at_idx" ON "platform_invoices"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_invoices_created_at_idx" ON "platform_invoices"("created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_invoices_stripe_subscription_id_idx" ON "platform_invoices"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "platform_invoices_number_idx" ON "platform_invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "platform_payments_stripe_payment_intent_id_key" ON "platform_payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_payments_stripe_charge_id_key" ON "platform_payments"("stripe_charge_id");

-- CreateIndex
CREATE INDEX "platform_payments_organization_id_created_at_idx" ON "platform_payments"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_payments_status_created_at_idx" ON "platform_payments"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_payments_created_at_idx" ON "platform_payments"("created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_payments_stripe_invoice_id_idx" ON "platform_payments"("stripe_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_refunds_stripe_refund_id_key" ON "platform_refunds"("stripe_refund_id");

-- CreateIndex
CREATE INDEX "platform_refunds_payment_id_idx" ON "platform_refunds"("payment_id");

-- CreateIndex
CREATE INDEX "platform_refunds_stripe_charge_id_idx" ON "platform_refunds"("stripe_charge_id");

-- CreateIndex
CREATE INDEX "platform_refunds_organization_id_created_at_idx" ON "platform_refunds"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_refunds_created_at_idx" ON "platform_refunds"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "platform_disputes_stripe_dispute_id_key" ON "platform_disputes"("stripe_dispute_id");

-- CreateIndex
CREATE INDEX "platform_disputes_status_evidence_due_by_idx" ON "platform_disputes"("status", "evidence_due_by");

-- CreateIndex
CREATE INDEX "platform_disputes_organization_id_created_at_idx" ON "platform_disputes"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_disputes_created_at_idx" ON "platform_disputes"("created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_disputes_stripe_charge_id_idx" ON "platform_disputes"("stripe_charge_id");

-- CreateIndex
CREATE INDEX "platform_daily_metrics_key_day_idx" ON "platform_daily_metrics"("key", "day" DESC);

-- CreateIndex
CREATE INDEX "credit_ledger_entries_organization_id_meter_period_start_idx" ON "credit_ledger_entries"("organization_id", "meter", "period_start");

-- CreateIndex
CREATE INDEX "credit_ledger_entries_kind_created_at_idx" ON "credit_ledger_entries"("kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "credit_ledger_entries_created_at_idx" ON "credit_ledger_entries"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_entries_source_type_source_id_kind_key" ON "credit_ledger_entries"("source_type", "source_id", "kind");

-- CreateIndex
CREATE INDEX "quota_events_organization_id_created_at_idx" ON "quota_events"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quota_events_limit_key_created_at_idx" ON "quota_events"("limit_key", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quota_events_created_at_idx" ON "quota_events"("created_at" DESC);

