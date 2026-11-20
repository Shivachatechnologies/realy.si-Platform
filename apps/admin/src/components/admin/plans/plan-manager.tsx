"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { useI18n } from "@/i18n/client";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { ActionDialog, useAdminAction } from "@/components/admin/action-dialog";
import { ADDON_KEYS, ADDONS, FEATURE_KEYS, LIMIT_KEYS, LIMITS, isHighCostLimit, type LimitKey } from "@/server/modules/entitlements/catalog";

// ───────────── DTOs (server pages → client) ─────────────

export interface PlanEditDTO {
  id: string;
  key: string;
  name: string;
  description: string;
  status: string;
  public: boolean;
  defaultTrialDays: number;
  entitlements: { featureKey: string; enabled: boolean; limitValue: string | null }[];
  prices: { id: string; interval: string; marketType: string; marketCode: string; currency: string; status: string; current: { version: number; amountMinor: string; trialDays: number | null; effectiveFrom: string } | null }[];
}

const label = (t: (k: string) => string, k: string) => {
  const v = t(`admin.plans.manager.keys.${k.replace(/\./g, "_")}`);
  return v.startsWith("admin.plans.manager.keys.") ? k : v;
};

/** Create plan (draft): key, name, trial days. */
export function CreatePlanButton() {
  const { t } = useI18n();
  const run = useAdminAction();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [trial, setTrial] = useState("0");
  return (
    <ActionDialog
      trigger={<Button size="sm">{t("admin.plans.manager.createPlan")}</Button>}
      title={t("admin.plans.manager.createPlan")}
      description={t("admin.plans.manager.createPlanHint")}
      confirmLabel={t("admin.plans.manager.create")}
      canSubmit={/^[a-z][a-z0-9-]{1,40}$/.test(key) && name.trim().length > 0}
      onConfirm={() => run("/api/v1/admin/plans", "POST", { key, name, defaultTrialDays: Number(trial) || 0, public: false })}
    >
      <Field label={t("admin.plans.manager.planKey")} htmlFor="np-key" hint={t("admin.plans.manager.planKeyHint")}>
        <Input id="np-key" dir="ltr" className="font-mono" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} />
      </Field>
      <Field label={t("admin.plans.manager.planName")} htmlFor="np-name">
        <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("admin.plans.manager.trialDays")} htmlFor="np-trial">
        <Input id="np-trial" type="number" min={0} max={365} value={trial} onChange={(e) => setTrial(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

/** One plan: details, prices (new version per change), limits / credit allocation and features. */
export function PlanEditor({ plan, canManage }: { plan: PlanEditDTO; canManage: boolean }) {
  const { t, locale } = useI18n();
  const run = useAdminAction();
  const ent = (k: string) => plan.entitlements.find((e) => e.featureKey === k);
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [status, setStatus] = useState(plan.status);
  const [isPublic, setPublic] = useState(plan.public);
  const [trial, setTrial] = useState(String(plan.defaultTrialDays));

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {plan.name}
            <span className="font-mono text-xs text-muted-foreground">{plan.key}</span>
            <Badge tone={plan.status === "ACTIVE" ? "success" : plan.status === "DRAFT" ? "neutral" : "danger"}>{plan.status}</Badge>
            {!plan.public ? <Badge tone="neutral">{t("admin.plans.manager.hidden")}</Badge> : null}
          </span>
        }
        description={t("admin.plans.trial", { count: plan.defaultTrialDays })}
        actions={
          canManage ? (
            <ActionDialog
              trigger={<Button size="sm" variant="secondary">{t("admin.plans.manager.editPlan")}</Button>}
              title={t("admin.plans.manager.editPlan")}
              confirmLabel={t("common.save")}
              onConfirm={(reason) => run(`/api/v1/admin/plans/${plan.id}`, "PATCH", { name, description, status, public: isPublic, defaultTrialDays: Number(trial) || 0, reason })}
            >
              <Field label={t("admin.plans.manager.planName")} htmlFor={`pn-${plan.id}`}>
                <Input id={`pn-${plan.id}`} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t("admin.plans.manager.description")} htmlFor={`pd-${plan.id}`}>
                <Input id={`pd-${plan.id}`} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("admin.plans.manager.status")} htmlFor={`ps-${plan.id}`}>
                  <Select id={`ps-${plan.id}`} value={status} onChange={(e) => setStatus(e.target.value)}>
                    {["DRAFT", "ACTIVE", "DISABLED"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("admin.plans.manager.trialDays")} htmlFor={`pt-${plan.id}`}>
                  <Input id={`pt-${plan.id}`} type="number" min={0} max={365} value={trial} onChange={(e) => setTrial(e.target.value)} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />
                {t("admin.plans.manager.public")}
              </label>
            </ActionDialog>
          ) : null
        }
      />
      <CardBody className="grid gap-5">
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.plans.manager.prices")}</h3>
          {plan.prices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.plans.manager.noPrices")}</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.plans.manager.market")}</Th>
                  <Th>{t("admin.plans.manager.interval")}</Th>
                  <Th>{t("admin.plans.manager.amount")}</Th>
                  <Th>{t("admin.plans.manager.version")}</Th>
                  {canManage ? <Th /> : null}
                </Tr>
              </THead>
              <TBody>
                {plan.prices.map((p) => (
                  <PriceRow key={p.id} price={p} canManage={canManage} locale={locale} />
                ))}
              </TBody>
            </Table>
          )}
        </section>

        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.plans.manager.limits")}</h3>
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.plans.manager.limit")}</Th>
                <Th>{t("admin.plans.manager.value")}</Th>
                {canManage ? <Th /> : null}
              </Tr>
            </THead>
            <TBody>
              {LIMIT_KEYS.map((k) => {
                const e = ent(k);
                const v = e ? (!e.enabled ? "0" : e.limitValue === null ? "∞" : formatNumber(BigInt(e.limitValue), locale)) : "—";
                return (
                  <Tr key={k}>
                    <Td>
                      <div>{label(t, k)}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {k} · {LIMITS[k].unit}
                        {isHighCostLimit(k) ? ` · ${t("admin.plans.manager.highCost")}` : ""}
                      </div>
                    </Td>
                    <Td className="tabular">{v}</Td>
                    {canManage ? (
                      <Td>
                        <LimitEdit planId={plan.id} limitKey={k} current={e?.limitValue ?? ""} />
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </section>

        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.plans.manager.features")}</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_KEYS.map((k) => {
              const on = ent(k)?.enabled ?? false;
              return (
                <li key={k} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 truncate" title={k}>
                    {label(t, k)}
                  </span>
                  {canManage ? (
                    <ActionDialog
                      trigger={
                        <Button size="sm" variant={on ? "secondary" : "ghost"}>
                          {on ? t("admin.plans.manager.included") : t("admin.plans.manager.excluded")}
                        </Button>
                      }
                      title={on ? t("admin.plans.manager.removeFeature") : t("admin.plans.manager.addFeature")}
                      description={label(t, k)}
                      confirmLabel={t("common.save")}
                      onConfirm={(reason) => run(`/api/v1/admin/plans/${plan.id}/entitlements`, "PUT", { featureKey: k, enabled: !on, limitValue: null, reason })}
                    />
                  ) : (
                    <Badge tone={on ? "success" : "neutral"}>{on ? t("admin.plans.manager.included") : t("admin.plans.manager.excluded")}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </CardBody>
    </Card>
  );
}

function PriceRow({ price, canManage, locale }: { price: PlanEditDTO["prices"][number]; canManage: boolean; locale: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [amount, setAmount] = useState(price.current ? (Number(price.current.amountMinor) / 100).toFixed(2) : "");
  const [trial, setTrial] = useState(price.current?.trialDays != null ? String(price.current.trialDays) : "");
  const [from, setFrom] = useState("");
  const minor = Math.round(Number(amount) * 100);
  return (
    <Tr>
      <Td className="font-mono text-xs">
        {price.marketType}:{price.marketCode}
      </Td>
      <Td>{t(`admin.plans.manager.intervals.${price.interval}`)}</Td>
      <Td className="tabular">{price.current ? formatMoney({ amountMinor: price.current.amountMinor, currency: price.currency }, locale) : "—"}</Td>
      <Td className="text-xs text-muted-foreground">{price.current ? `v${price.current.version} · ${formatDate(price.current.effectiveFrom, locale, "UTC")}` : "—"}</Td>
      {canManage ? (
        <Td>
          <ActionDialog
            trigger={<Button size="sm" variant="ghost">{t("admin.plans.manager.changePrice")}</Button>}
            title={t("admin.plans.manager.changePrice")}
            description={t("admin.plans.manager.changePriceHint")}
            confirmLabel={t("admin.plans.manager.scheduleVersion")}
            canSubmit={Number.isFinite(minor) && minor >= 0}
            onConfirm={(reason) =>
              run(`/api/v1/admin/prices/${price.id}/versions`, "POST", {
                amountMinor: String(minor),
                ...(trial !== "" ? { trialDays: Number(trial) } : {}),
                ...(from ? { effectiveFrom: new Date(from).toISOString() } : {}),
                reason,
              })
            }
          >
            <Field label={`${t("admin.plans.manager.amount")} (${price.currency})`} htmlFor={`pa-${price.id}`}>
              <Input id={`pa-${price.id}`} inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={t("admin.plans.manager.trialDays")} htmlFor={`ptd-${price.id}`} hint={t("admin.plans.manager.trialPriceHint")}>
              <Input id={`ptd-${price.id}`} type="number" min={0} max={365} value={trial} onChange={(e) => setTrial(e.target.value)} />
            </Field>
            <Field label={t("admin.plans.manager.effectiveFrom")} htmlFor={`pf-${price.id}`} hint={t("admin.plans.manager.effectiveFromHint")}>
              <Input id={`pf-${price.id}`} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </ActionDialog>
        </Td>
      ) : null}
    </Tr>
  );
}

function LimitEdit({ planId, limitKey, current }: { planId: string; limitKey: LimitKey; current: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [value, setValue] = useState(current);
  const highCost = isHighCostLimit(limitKey);
  const valid = value === "" ? !highCost : /^\d{1,15}$/.test(value);
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="ghost">{t("admin.plans.manager.edit")}</Button>}
      title={t("admin.plans.manager.editLimit")}
      description={limitKey}
      confirmLabel={t("common.save")}
      canSubmit={valid}
      onConfirm={(reason) => run(`/api/v1/admin/plans/${planId}/entitlements`, "PUT", { featureKey: limitKey, enabled: true, limitValue: value === "" ? null : value, reason })}
    >
      <Field label={t("admin.plans.manager.value")} htmlFor={`lv-${planId}-${limitKey}`} hint={highCost ? t("admin.plans.manager.highCostHint") : t("admin.plans.manager.emptyUnlimited")}>
        <Input id={`lv-${planId}-${limitKey}`} inputMode="numeric" dir="ltr" value={value} onChange={(e) => setValue(e.target.value.trim())} />
      </Field>
    </ActionDialog>
  );
}

/** New promotion with an optional coupon code (percent or fixed amount, plans, window, redemptions). */
export function CreatePromotionButton({ planKeys }: { planKeys: string[] }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [name, setName] = useState("");
  const [type, setType] = useState<"PERCENT" | "AMOUNT">("PERCENT");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [code, setCode] = useState("");
  const [plans, setPlans] = useState<string[]>([]);
  const [ends, setEnds] = useState("");
  const [max, setMax] = useState("");
  const n = Number(value);
  const ok = name.trim().length > 0 && n > 0 && (type === "AMOUNT" || n <= 100) && (!code || /^[A-Z0-9_-]{3,40}$/.test(code));
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="secondary">{t("admin.plans.manager.createPromo")}</Button>}
      title={t("admin.plans.manager.createPromo")}
      description={t("admin.plans.manager.createPromoHint")}
      confirmLabel={t("admin.plans.manager.create")}
      canSubmit={ok}
      onConfirm={(reason) =>
        run("/api/v1/admin/promotions", "POST", {
          name,
          discountType: type,
          ...(type === "PERCENT" ? { percentOffBps: Math.round(n * 100) } : { amountOffMinor: String(Math.round(n * 100)), currency }),
          planKeys: plans,
          startsAt: new Date().toISOString(),
          ...(ends ? { endsAt: new Date(ends).toISOString() } : {}),
          ...(max ? { maxRedemptions: Number(max) } : {}),
          ...(code ? { couponCode: code } : {}),
          reason,
        })
      }
    >
      <Field label={t("admin.plans.manager.promoName")} htmlFor="pr-name">
        <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("admin.plans.manager.discountType")} htmlFor="pr-type">
          <Select id="pr-type" value={type} onChange={(e) => setType(e.target.value as "PERCENT" | "AMOUNT")}>
            <option value="PERCENT">{t("admin.plans.manager.percent")}</option>
            <option value="AMOUNT">{t("admin.plans.manager.fixedAmount")}</option>
          </Select>
        </Field>
        <Field label={type === "PERCENT" ? "%" : t("admin.plans.manager.amount")} htmlFor="pr-value">
          <Input id="pr-value" inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </div>
      {type === "AMOUNT" ? (
        <Field label={t("admin.plans.manager.currency")} htmlFor="pr-cur">
          <Select id="pr-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {["USD", "EUR", "GBP", "INR", "AED"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t("admin.plans.manager.couponCode")} htmlFor="pr-code" hint={t("admin.plans.manager.couponHint")}>
        <Input id="pr-code" dir="ltr" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </Field>
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">{t("admin.plans.manager.appliesTo")}</legend>
        {planKeys.map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={plans.includes(k)} onChange={(e) => setPlans((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))} />
            <span className="font-mono text-xs">{k}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("admin.plans.manager.endsAt")} htmlFor="pr-ends">
          <Input id="pr-ends" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </Field>
        <Field label={t("admin.plans.manager.maxRedemptions")} htmlFor="pr-max">
          <Input id="pr-max" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
      </div>
    </ActionDialog>
  );
}

// ───────────── Organization: overrides, add-on grants, subscription ─────────────

export function GrantOverrideButton({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [key, setKey] = useState<string>(LIMIT_KEYS[0]!);
  const [enabled, setEnabled] = useState(true);
  const [value, setValue] = useState("");
  const [expires, setExpires] = useState("");
  const isLimit = (LIMIT_KEYS as string[]).includes(key);
  const highCost = isLimit && isHighCostLimit(key as LimitKey);
  const ok = !isLimit || !enabled || (value === "" ? !highCost : /^\d{1,15}$/.test(value));
  return (
    <ActionDialog
      trigger={<Button size="sm">{t("admin.plans.manager.grantOverride")}</Button>}
      title={t("admin.plans.manager.grantOverride")}
      description={t("admin.plans.manager.grantOverrideHint")}
      confirmLabel={t("admin.plans.manager.grant")}
      canSubmit={ok}
      onConfirm={(reason) =>
        run("/api/v1/admin/entitlements/overrides", "POST", {
          organizationId,
          key,
          enabled,
          limitValue: isLimit && enabled ? (value === "" ? null : value) : null,
          ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}),
          reason,
        })
      }
    >
      <Field label={t("admin.plans.manager.key")} htmlFor="ov-key">
        <Select id="ov-key" value={key} onChange={(e) => setKey(e.target.value)}>
          <optgroup label={t("admin.plans.manager.limits")}>
            {LIMIT_KEYS.map((k) => (
              <option key={k} value={k}>
                {label(t, k)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("admin.plans.manager.features")}>
            {FEATURE_KEYS.map((k) => (
              <option key={k} value={k}>
                {label(t, k)}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {isLimit ? t("admin.plans.manager.limitEnabled") : t("admin.plans.manager.featureGranted")}
      </label>
      {isLimit && enabled ? (
        <Field label={t("admin.plans.manager.value")} htmlFor="ov-value" hint={highCost ? t("admin.plans.manager.highCostHint") : t("admin.plans.manager.emptyUnlimited")}>
          <Input id="ov-value" inputMode="numeric" dir="ltr" value={value} onChange={(e) => setValue(e.target.value.trim())} />
        </Field>
      ) : null}
      <Field label={t("admin.plans.manager.expiresAt")} htmlFor="ov-exp" hint={t("admin.plans.manager.expiresHint")}>
        <Input id="ov-exp" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

export function RevokeOverrideButton({ overrideId }: { overrideId: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="ghost">{t("admin.plans.manager.revoke")}</Button>}
      title={t("admin.plans.manager.revoke")}
      confirmLabel={t("admin.plans.manager.revoke")}
      danger
      onConfirm={(reason) => run(`/api/v1/admin/entitlements/overrides/${overrideId}`, "DELETE", { reason })}
    />
  );
}

export function GrantAddonButton({ organizationId }: { organizationId: string }) {
  const { t, locale } = useI18n();
  const run = useAdminAction();
  const [addonKey, setAddonKey] = useState<string>(ADDON_KEYS[0]!);
  const [packs, setPacks] = useState("1");
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="secondary">{t("admin.plans.manager.grantAddon")}</Button>}
      title={t("admin.plans.manager.grantAddon")}
      description={t("admin.plans.manager.grantAddonHint")}
      confirmLabel={t("admin.plans.manager.grant")}
      canSubmit={Number(packs) >= 1 && Number(packs) <= 100}
      onConfirm={(reason) => run("/api/v1/admin/entitlements/addons", "POST", { organizationId, addonKey, packs: Number(packs), reason })}
    >
      <Field label={t("admin.plans.manager.addon")} htmlFor="ad-key">
        <Select id="ad-key" value={addonKey} onChange={(e) => setAddonKey(e.target.value)}>
          {ADDON_KEYS.map((k) => (
            <option key={k} value={k}>
              {label(t, ADDONS[k].limit)} +{formatNumber(ADDONS[k].quantity, locale)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("admin.plans.manager.packs")} htmlFor="ad-packs">
        <Input id="ad-packs" type="number" min={1} max={100} value={packs} onChange={(e) => setPacks(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

export function SubscriptionActions({ organizationId, planKeys, hasSubscription, cancelAtPeriodEnd }: { organizationId: string; planKeys: string[]; hasSubscription: boolean; cancelAtPeriodEnd: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [planKey, setPlanKey] = useState(planKeys[0] ?? "");
  const [interval, setInterval] = useState<"MONTH" | "YEAR">("MONTH");
  if (!hasSubscription) return <p className="text-sm text-muted-foreground">{t("admin.plans.manager.noSubscription")}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      <ActionDialog
        trigger={<Button size="sm">{t("admin.plans.manager.changeSubscription")}</Button>}
        title={t("admin.plans.manager.changeSubscription")}
        description={t("admin.plans.manager.changeSubscriptionHint")}
        confirmLabel={t("admin.plans.manager.apply")}
        onConfirm={(reason) => run(`/api/v1/admin/entitlements/organizations/${organizationId}/subscription`, "POST", { planKey, interval, reason })}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("admin.plans.manager.plan")} htmlFor="sc-plan">
            <Select id="sc-plan" value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
              {planKeys.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("admin.plans.manager.interval")} htmlFor="sc-int">
            <Select id="sc-int" value={interval} onChange={(e) => setInterval(e.target.value as "MONTH" | "YEAR")}>
              <option value="MONTH">{t("admin.plans.manager.intervals.MONTH")}</option>
              <option value="YEAR">{t("admin.plans.manager.intervals.YEAR")}</option>
            </Select>
          </Field>
        </div>
      </ActionDialog>
      <ActionDialog
        trigger={<Button size="sm" variant={cancelAtPeriodEnd ? "secondary" : "danger"}>{cancelAtPeriodEnd ? t("admin.plans.manager.resume") : t("admin.plans.manager.cancelAtEnd")}</Button>}
        title={cancelAtPeriodEnd ? t("admin.plans.manager.resume") : t("admin.plans.manager.cancelAtEnd")}
        confirmLabel={t("admin.plans.manager.apply")}
        danger={!cancelAtPeriodEnd}
        onConfirm={(reason) => run(`/api/v1/admin/entitlements/organizations/${organizationId}/cancellation`, "POST", { cancel: !cancelAtPeriodEnd, reason })}
      />
    </div>
  );
}
