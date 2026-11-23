"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { ActionDialog, useAdminAction } from "@/components/admin/action-dialog";
import { useI18n } from "@/i18n/client";
import { formatMoney, minorUnits } from "@/i18n/format";
import { api } from "@/lib/api-client";

/** "12.50" → 1250n in the currency's minor units (exact; no floating point). null when not a valid amount. */
export function toMinor(input: string, currency: string): bigint | null {
  const digits = minorUnits(currency);
  const m = input.trim().match(digits === 0 ? /^(\d{1,13})$/ : new RegExp(`^(\\d{1,13})(?:[.,](\\d{1,${digits}}))?$`));
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(digits, "0");
  return BigInt(m[1]!) * 10n ** BigInt(digits) + (digits ? BigInt(frac || "0") : 0n);
}

const toMajor = (minor: string, currency: string) => {
  const digits = minorUnits(currency);
  const s = minor.padStart(digits + 1, "0");
  return digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
};

// ───────────── Refund ─────────────

/** Real Stripe refund (full or partial): reason, Stripe reason code and the charge id typed as confirmation. */
export function RefundButton({ paymentId, chargeId, currency, refundableMinor, livemode }: { paymentId: string; chargeId: string; currency: string; refundableMinor: string; livemode: boolean }) {
  const { t, locale } = useI18n();
  const run = useAdminAction({ success: t("admin.payments.refund.done") });
  const [amount, setAmount] = useState(toMajor(refundableMinor, currency));
  const [code, setCode] = useState("requested_by_customer");
  const minor = toMinor(amount, currency);
  const valid = minor !== null && minor > 0n && minor <= BigInt(refundableMinor);
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="danger">{t("admin.payments.refund.button")}</Button>}
      title={t("admin.payments.refund.title")}
      description={t("admin.payments.refund.hint", { max: formatMoney({ amountMinor: refundableMinor, currency }, locale) })}
      confirmLabel={t("admin.payments.refund.confirm")}
      phrase={chargeId}
      danger
      canSubmit={valid}
      onConfirm={(reason, confirm) => run("/api/v1/admin/refunds", "POST", { paymentId, amountMinor: minor!.toString(), stripeReason: code, reason, confirm })}
    >
      {livemode ? <Notice tone="danger">{t("admin.payments.refund.live")}</Notice> : <Notice tone="info">{t("admin.payments.refund.test")}</Notice>}
      <Field label={`${t("admin.payments.refund.amount")} (${currency})`} htmlFor="rf-amount" hint={valid ? undefined : t("admin.payments.refund.amountHint")}>
        <Input id="rf-amount" dir="ltr" inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label={t("admin.payments.refund.stripeReason")} htmlFor="rf-code">
        <Select id="rf-code" value={code} onChange={(e) => setCode(e.target.value)}>
          {(["requested_by_customer", "duplicate", "fraudulent"] as const).map((c) => (
            <option key={c} value={c}>
              {t(`admin.payments.refund.codes.${c}`)}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

// ───────────── Stripe backfill ─────────────

type BackfillResult = { kind: string; processed: number; applied: number; hasMore: boolean; nextCursor: string | null };

/** Guarded admin backfill of the mirror tables from Stripe's list APIs, 300 objects per run, with "continue". */
export function BackfillPanel({ configured }: { configured: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [kind, setKind] = useState("invoices");
  const [sinceDays, setSinceDays] = useState("90");
  const [last, setLast] = useState<(BackfillResult & { reason: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const call = async (reason: string, cursor?: string) => {
    const r = await api<BackfillResult>("/api/v1/admin/invoices/sync", { method: "POST", body: { kind, sinceDays: Number(sinceDays), reason, ...(cursor ? { startingAfter: cursor } : {}) } });
    setLast({ ...r, reason });
    toast.success(t("admin.invoices.sync.done", { processed: r.processed, applied: r.applied }));
    router.refresh();
  };
  if (!configured) return <p className="text-sm text-muted-foreground">{t("admin.invoices.sync.notConfigured")}</p>;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("admin.invoices.sync.kind")} htmlFor="bf-kind">
          <Select id="bf-kind" value={kind} onChange={(e) => { setKind(e.target.value); setLast(null); }}>
            {(["invoices", "charges", "refunds", "disputes"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`admin.invoices.sync.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.invoices.sync.since")} htmlFor="bf-days">
          <Select id="bf-days" value={sinceDays} onChange={(e) => { setSinceDays(e.target.value); setLast(null); }}>
            {["30", "90", "365", "730"].map((d) => (
              <option key={d} value={d}>
                {t("admin.invoices.sync.days", { count: Number(d) })}
              </option>
            ))}
          </Select>
        </Field>
        <ActionDialog
          trigger={<Button size="sm" variant="secondary">{t("admin.invoices.sync.run")}</Button>}
          title={t("admin.invoices.sync.title")}
          description={t("admin.invoices.sync.hint")}
          confirmLabel={t("admin.invoices.sync.run")}
          onConfirm={(reason) => call(reason)}
        />
        {last?.hasMore && last.nextCursor ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await call(last.reason, last.nextCursor!);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("admin.invoices.sync.continue")}
          </Button>
        ) : null}
      </div>
      {last ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t("admin.invoices.sync.result", { processed: last.processed, applied: last.applied })} {last.hasMore ? t("admin.invoices.sync.more") : t("admin.invoices.sync.complete")}
        </p>
      ) : null}
    </div>
  );
}

// ───────────── Subscription actions ─────────────

export function SubscriptionAdminActions({
  subscriptionId,
  status,
  cancelAtPeriodEnd,
  pauseCollection,
  trialEndsAt,
  planKeys,
  orgSlug,
  stripe,
}: {
  subscriptionId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  pauseCollection: string | null;
  trialEndsAt: string | null;
  planKeys: string[];
  orgSlug: string;
  stripe: boolean;
}) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.subscriptions.actions.requested") });
  const [planKey, setPlanKey] = useState(planKeys[0] ?? "");
  const [interval, setInterval] = useState<"MONTH" | "YEAR">("MONTH");
  const [behavior, setBehavior] = useState("keep_as_draft");
  const [trialEnd, setTrialEnd] = useState("");
  const [coupon, setCoupon] = useState("");
  const base = `/api/v1/admin/subscriptions/${subscriptionId}`;
  if (!stripe) return <p className="text-sm text-muted-foreground">{t("admin.subscriptions.actions.notStripe")}</p>;
  const live = ["ACTIVE", "TRIALING", "PAST_DUE"].includes(status);
  const ended = status === "CANCELED" || status === "INCOMPLETE_EXPIRED";
  if (ended) return <p className="text-sm text-muted-foreground">{t("admin.subscriptions.actions.ended")}</p>;
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{t("admin.subscriptions.actions.webhookNote")}</p>
      <div className="flex flex-wrap gap-2">
        {live ? (
          <ActionDialog
            trigger={<Button size="sm">{t("admin.subscriptions.actions.changePlan")}</Button>}
            title={t("admin.subscriptions.actions.changePlan")}
            description={t("admin.subscriptions.actions.changePlanHint")}
            confirmLabel={t("admin.subscriptions.actions.apply")}
            onConfirm={(reason) => run(`${base}/plan`, "POST", { planKey, interval, reason })}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("admin.subscriptions.plan")} htmlFor="sa-plan">
                <Select id="sa-plan" value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
                  {planKeys.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("admin.pricing.interval")} htmlFor="sa-int">
                <Select id="sa-int" value={interval} onChange={(e) => setInterval(e.target.value as "MONTH" | "YEAR")}>
                  <option value="MONTH">{t("admin.subscriptions.interval.MONTH")}</option>
                  <option value="YEAR">{t("admin.subscriptions.interval.YEAR")}</option>
                </Select>
              </Field>
            </div>
          </ActionDialog>
        ) : null}
        {live ? (
          <ActionDialog
            trigger={<Button size="sm" variant="secondary">{cancelAtPeriodEnd ? t("admin.subscriptions.actions.resume") : t("admin.subscriptions.actions.cancelAtEnd")}</Button>}
            title={cancelAtPeriodEnd ? t("admin.subscriptions.actions.resume") : t("admin.subscriptions.actions.cancelAtEnd")}
            description={cancelAtPeriodEnd ? t("admin.subscriptions.actions.resumeHint") : t("admin.subscriptions.actions.cancelAtEndHint")}
            confirmLabel={t("admin.subscriptions.actions.apply")}
            onConfirm={(reason) => run(`${base}/cancel`, "POST", { mode: cancelAtPeriodEnd ? "resume" : "period_end", reason })}
          />
        ) : null}
        <ActionDialog
          trigger={<Button size="sm" variant="secondary">{pauseCollection ? t("admin.subscriptions.actions.unpause") : t("admin.subscriptions.actions.pause")}</Button>}
          title={pauseCollection ? t("admin.subscriptions.actions.unpause") : t("admin.subscriptions.actions.pause")}
          description={pauseCollection ? t("admin.subscriptions.actions.unpauseHint") : t("admin.subscriptions.actions.pauseHint")}
          confirmLabel={t("admin.subscriptions.actions.apply")}
          onConfirm={(reason) => run(`${base}/pause`, "POST", { behavior: pauseCollection ? null : behavior, reason })}
        >
          {pauseCollection ? null : (
            <Field label={t("admin.subscriptions.actions.pauseBehavior")} htmlFor="sa-beh">
              <Select id="sa-beh" value={behavior} onChange={(e) => setBehavior(e.target.value)}>
                {(["keep_as_draft", "mark_uncollectible", "void"] as const).map((b) => (
                  <option key={b} value={b}>
                    {t(`admin.subscriptions.actions.behaviors.${b}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </ActionDialog>
        {status === "TRIALING" ? (
          <ActionDialog
            trigger={<Button size="sm" variant="secondary">{t("admin.subscriptions.actions.extendTrial")}</Button>}
            title={t("admin.subscriptions.actions.extendTrial")}
            description={t("admin.subscriptions.actions.extendTrialHint")}
            confirmLabel={t("admin.subscriptions.actions.apply")}
            canSubmit={!!trialEnd && (!trialEndsAt || new Date(trialEnd) > new Date(trialEndsAt))}
            onConfirm={(reason) => run(`${base}/trial`, "POST", { trialEndsAt: new Date(trialEnd).toISOString(), reason })}
          >
            <Field label={t("admin.subscriptions.actions.newTrialEnd")} htmlFor="sa-trial">
              <Input id="sa-trial" type="datetime-local" value={trialEnd} onChange={(e) => setTrialEnd(e.target.value)} />
            </Field>
          </ActionDialog>
        ) : null}
        {live ? (
          <ActionDialog
            trigger={<Button size="sm" variant="secondary">{t("admin.subscriptions.actions.applyCoupon")}</Button>}
            title={t("admin.subscriptions.actions.applyCoupon")}
            description={t("admin.subscriptions.actions.applyCouponHint")}
            confirmLabel={t("admin.subscriptions.actions.apply")}
            canSubmit={coupon.trim().length > 0}
            onConfirm={(reason) => run(`${base}/coupon`, "POST", { couponCode: coupon.trim(), reason })}
          >
            <Field label={t("admin.subscriptions.actions.couponCode")} htmlFor="sa-coupon">
              <Input id="sa-coupon" dir="ltr" className="font-mono" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
            </Field>
          </ActionDialog>
        ) : null}
        <ActionDialog
          trigger={<Button size="sm" variant="danger">{t("admin.subscriptions.actions.cancelNow")}</Button>}
          title={t("admin.subscriptions.actions.cancelNow")}
          description={t("admin.subscriptions.actions.cancelNowHint")}
          confirmLabel={t("admin.subscriptions.actions.cancelNow")}
          phrase={orgSlug}
          danger
          onConfirm={(reason, confirm) => run(`${base}/cancel`, "POST", { mode: "immediately", reason, confirm })}
        />
      </div>
    </div>
  );
}

// ───────────── Credits ─────────────

/** ± allowance for the organization's current window (ADJUSTMENT, PROMOTION or REFUND), reason required, audited. */
export function CreditAdjustButton({ organizationId, meters, defaultMeter }: { organizationId: string; meters: string[]; defaultMeter?: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.credits.adjust.done") });
  const [meter, setMeter] = useState(defaultMeter ?? meters[0] ?? "ai.credits");
  const [kind, setKind] = useState<"ADJUSTMENT" | "PROMOTION" | "REFUND">("ADJUSTMENT");
  const [delta, setDelta] = useState("");
  const n = /^-?\d{1,12}$/.test(delta.trim()) ? BigInt(delta.trim()) : null;
  const valid = n !== null && n !== 0n && (kind === "ADJUSTMENT" || n > 0n);
  return (
    <ActionDialog
      trigger={<Button size="sm">{t("admin.credits.adjust.button")}</Button>}
      title={t("admin.credits.adjust.title")}
      description={t("admin.credits.adjust.hint")}
      confirmLabel={t("admin.credits.adjust.confirm")}
      canSubmit={valid}
      onConfirm={(reason) => run("/api/v1/admin/credits/adjustments", "POST", { organizationId, meter, kind, delta: n!.toString(), reason })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("admin.credits.meter")} htmlFor="ca-meter">
          <Select id="ca-meter" value={meter} onChange={(e) => setMeter(e.target.value)}>
            {meters.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.credits.kind")} htmlFor="ca-kind">
          <Select id="ca-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {(["ADJUSTMENT", "PROMOTION", "REFUND"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`admin.credits.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("admin.credits.adjust.delta")} htmlFor="ca-delta" hint={t("admin.credits.adjust.deltaHint")}>
        <Input id="ca-delta" dir="ltr" inputMode="numeric" className="tabular" value={delta} onChange={(e) => setDelta(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

// ───────────── Plan lifecycle ─────────────

export function PlanLifecycleActions({ planId, planKey, status, liveSubscriptions }: { planId: string; planKey: string; status: string; liveSubscriptions: number }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [key, setKey] = useState(`${planKey}-copy`.slice(0, 41));
  const [name, setName] = useState("");
  const [withPrices, setWithPrices] = useState(true);
  return (
    <div className="flex flex-wrap gap-2">
      <ActionDialog
        trigger={<Button size="sm" variant="ghost">{t("admin.plans.lifecycle.clone")}</Button>}
        title={t("admin.plans.lifecycle.clone")}
        description={t("admin.plans.lifecycle.cloneHint")}
        confirmLabel={t("admin.plans.lifecycle.clone")}
        canSubmit={/^[a-z][a-z0-9-]{1,40}$/.test(key) && name.trim().length > 0}
        onConfirm={(reason) => run(`/api/v1/admin/plans/${planId}/clone`, "POST", { key, name, withPrices, reason }, { success: t("admin.plans.lifecycle.cloned") })}
      >
        <Field label={t("admin.plans.manager.planKey")} htmlFor={`cl-key-${planId}`} hint={t("admin.plans.manager.planKeyHint")}>
          <Input id={`cl-key-${planId}`} dir="ltr" className="font-mono" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} />
        </Field>
        <Field label={t("admin.plans.manager.planName")} htmlFor={`cl-name-${planId}`}>
          <Input id={`cl-name-${planId}`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withPrices} onChange={(e) => setWithPrices(e.target.checked)} />
          {t("admin.plans.lifecycle.withPrices")}
        </label>
      </ActionDialog>
      {status !== "ACTIVE" ? (
        <ActionDialog
          trigger={<Button size="sm" variant="secondary">{t("admin.plans.lifecycle.publish")}</Button>}
          title={t("admin.plans.lifecycle.publish")}
          description={t("admin.plans.lifecycle.publishHint")}
          confirmLabel={t("admin.plans.lifecycle.publish")}
          onConfirm={(reason) => run(`/api/v1/admin/plans/${planId}/publish`, "POST", { reason }, { success: t("admin.plans.lifecycle.published") })}
        />
      ) : null}
      {status !== "DISABLED" ? (
        <ActionDialog
          trigger={<Button size="sm" variant="danger">{t("admin.plans.lifecycle.archive")}</Button>}
          title={t("admin.plans.lifecycle.archive")}
          description={t("admin.plans.lifecycle.archiveHint", { count: liveSubscriptions })}
          confirmLabel={t("admin.plans.lifecycle.archive")}
          phrase={planKey}
          danger
          onConfirm={(reason, confirm) => run(`/api/v1/admin/plans/${planId}/archive`, "POST", { reason, confirm }, { success: t("admin.plans.lifecycle.archived") })}
        />
      ) : null}
    </div>
  );
}

/** First price of a market for a plan (a new plan has none and cannot be published until it has one). */
export function AddPriceButton({ planId }: { planId: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.plans.lifecycle.priceAdded") });
  const [marketType, setMarketType] = useState<"GLOBAL" | "REGION" | "COUNTRY">("GLOBAL");
  const [marketCode, setMarketCode] = useState("*");
  const [interval, setInterval] = useState<"MONTH" | "YEAR">("MONTH");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const minor = /^[A-Z]{3}$/.test(currency) ? toMinor(amount, currency) : null;
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="ghost">{t("admin.plans.lifecycle.addPrice")}</Button>}
      title={t("admin.plans.lifecycle.addPrice")}
      description={t("admin.plans.lifecycle.addPriceHint")}
      confirmLabel={t("admin.plans.lifecycle.addPrice")}
      canSubmit={minor !== null && marketCode.trim().length > 0}
      onConfirm={(reason) => run(`/api/v1/admin/plans/${planId}/prices`, "POST", { marketType, marketCode: marketType === "GLOBAL" ? "*" : marketCode.trim().toUpperCase(), interval, currency, amountMinor: minor!.toString(), reason })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("admin.plans.manager.market")} htmlFor={`ap-mt-${planId}`}>
          <Select id={`ap-mt-${planId}`} value={marketType} onChange={(e) => { const v = e.target.value as typeof marketType; setMarketType(v); if (v === "GLOBAL") setMarketCode("*"); }}>
            {(["GLOBAL", "REGION", "COUNTRY"] as const).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.pricing.marketCode")} htmlFor={`ap-mc-${planId}`}>
          <Input id={`ap-mc-${planId}`} dir="ltr" className="font-mono" disabled={marketType === "GLOBAL"} value={marketCode} onChange={(e) => setMarketCode(e.target.value)} />
        </Field>
        <Field label={t("admin.plans.manager.interval")} htmlFor={`ap-int-${planId}`}>
          <Select id={`ap-int-${planId}`} value={interval} onChange={(e) => setInterval(e.target.value as "MONTH" | "YEAR")}>
            <option value="MONTH">{t("admin.plans.manager.intervals.MONTH")}</option>
            <option value="YEAR">{t("admin.plans.manager.intervals.YEAR")}</option>
          </Select>
        </Field>
        <Field label={t("admin.pricing.currency")} htmlFor={`ap-cur-${planId}`}>
          <Input id={`ap-cur-${planId}`} dir="ltr" className="font-mono" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
      </div>
      <Field label={t("admin.plans.manager.amount")} htmlFor={`ap-amt-${planId}`}>
        <Input id={`ap-amt-${planId}`} dir="ltr" inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

/** Disable / re-enable a promotion (its coupon codes stop validating at checkout). */
export function PromotionToggle({ promotionId, active }: { promotionId: string; active: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  return (
    <ActionDialog
      trigger={<Button size="sm" variant={active ? "ghost" : "secondary"}>{active ? t("admin.plans.lifecycle.disablePromotion") : t("admin.plans.lifecycle.enablePromotion")}</Button>}
      title={active ? t("admin.plans.lifecycle.disablePromotion") : t("admin.plans.lifecycle.enablePromotion")}
      description={active ? t("admin.plans.lifecycle.disablePromotionHint") : undefined}
      confirmLabel={t("admin.subscriptions.actions.apply")}
      danger={active}
      onConfirm={(reason) => run(`/api/v1/admin/promotions/${promotionId}`, "PATCH", { status: active ? "INACTIVE" : "ACTIVE", reason })}
    />
  );
}
