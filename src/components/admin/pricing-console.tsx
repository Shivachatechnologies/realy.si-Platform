"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { ChevronDown, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { displayName, formatDateTime, formatMoney, minorUnits } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn, parseMajorToMinor } from "@/lib/utils";
import { ReasonDialog } from "./reason-dialog";
import type { MarketOptions, MarketScope, PlanDTO, PriceDTO, PriceVersionDTO } from "./pricing-types";

function currentVersion(p: PriceDTO, now: number): PriceVersionDTO | undefined {
  return p.versions.find((v) => Date.parse(v.effectiveFrom) <= now && (!v.effectiveTo || Date.parse(v.effectiveTo) > now));
}

function scheduledVersions(p: PriceDTO, now: number) {
  return p.versions.filter((v) => Date.parse(v.effectiveFrom) > now);
}

/** Mirrors the server's market-chain check, for UI affordances only (the server re-checks every write). */
function canManageMarket(scope: MarketScope, options: MarketOptions, type: PriceDTO["marketType"], code: string) {
  if (scope.platform) return true;
  if (type === "REGION") return scope.regions.includes(code);
  if (type === "COUNTRY") {
    const region = options.countries.find((c) => c.code === code)?.regionCode;
    return scope.countries.includes(code) || (!!region && scope.regions.includes(region));
  }
  return false;
}

function useAction() {
  const router = useRouter();
  return async (path: string, method: string, body: unknown) => {
    await api(path, { method, body });
    router.refresh();
  };
}

export function PricingConsole({ plans, scope, options, timeZone, now }: { plans: PlanDTO[]; scope: MarketScope; options: MarketOptions; timeZone: string; now: number }) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(plans[0]?.id ?? null);
  const plan = plans.find((p) => p.id === selectedId) ?? plans[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit">
        <CardHeader title={t("admin.pricing.plans")} actions={scope.platform ? <NewPlanDialog /> : null} />
        <ul className="grid gap-0.5 p-1.5">
          {plans.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-current={p.id === plan?.id}
                className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start hover:bg-muted", p.id === plan?.id && "bg-muted")}
              >
                <span className="font-medium">{p.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{p.key}</span>
                <Badge className="ms-auto" tone={p.status === "ACTIVE" ? "success" : p.status === "DRAFT" ? "neutral" : "danger"}>
                  {t(`status.${p.status}`)}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {plan ? <PlanDetail key={plan.id} plan={plan} scope={scope} options={options} timeZone={timeZone} now={now} /> : null}
    </div>
  );
}

function PlanDetail({ plan, scope, options, timeZone, now }: { plan: PlanDTO; scope: MarketScope; options: MarketOptions; timeZone: string; now: number }) {
  const { t, locale } = useI18n();
  const act = useAction();
  const [expanded, setExpanded] = useState<string | null>(null);
  const market = (p: PriceDTO) =>
    p.marketType === "GLOBAL" ? t("admin.pricing.marketTypes.GLOBAL") : p.marketType === "COUNTRY" ? displayName(p.marketCode, "region", locale) : p.marketCode;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              {plan.name} <span className="font-mono text-xs font-normal text-muted-foreground">{plan.key}</span>
            </span>
          }
          actions={
            scope.platform ? (
              plan.status === "ACTIVE" ? (
                <ReasonDialog
                  trigger={<Button size="sm" variant="secondary">{t("admin.pricing.disable")}</Button>}
                  title={`${t("admin.pricing.disable")} · ${plan.name}`}
                  confirmLabel={t("admin.pricing.disable")}
                  onConfirm={(reason) => act(`/api/v1/admin/plans/${plan.id}`, "PATCH", { status: "DISABLED", reason })}
                />
              ) : (
                <ReasonDialog
                  trigger={<Button size="sm">{t("admin.pricing.activate")}</Button>}
                  title={`${t("admin.pricing.activate")} · ${plan.name}`}
                  confirmLabel={t("admin.pricing.activate")}
                  onConfirm={(reason) => act(`/api/v1/admin/plans/${plan.id}`, "PATCH", { status: "ACTIVE", reason })}
                />
              )
            ) : null
          }
        />
        <CardBody className="text-xs text-muted-foreground">
          {t("admin.pricing.trialDays")}: <span className="tabular font-mono text-foreground">{plan.defaultTrialDays}</span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("admin.pricing.markets")} description={t("admin.pricing.immutableNote")} actions={<AddPriceDialog plan={plan} scope={scope} options={options} />} />
        {plan.prices.length === 0 ? (
          <CardBody className="text-muted-foreground">{t("admin.pricing.noPrices")}</CardBody>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.pricing.market")}</Th>
                <Th>{t("admin.pricing.interval")}</Th>
                <Th>{t("admin.pricing.amount")}</Th>
                <Th>{t("admin.pricing.version")}</Th>
                <Th>{t("admin.pricing.effective")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {plan.prices.map((p) => {
                const cur = currentVersion(p, now);
                const sched = scheduledVersions(p, now);
                const manageable = canManageMarket(scope, options, p.marketType, p.marketCode);
                const open = expanded === p.id;
                return (
                  <Fragment key={p.id}>
                    <Tr>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Badge>{t(`admin.pricing.marketTypes.${p.marketType}`)}</Badge>
                          <span className="font-medium whitespace-nowrap">{market(p)}</span>
                          {p.marketType !== "GLOBAL" ? <span className="font-mono text-[11px] text-muted-foreground">{p.marketCode}</span> : null}
                        </div>
                      </Td>
                      <Td>{t(`settings.billing.interval.${p.interval}`)}</Td>
                      <Td className="tabular font-medium">{cur ? formatMoney(cur, locale) : "—"}</Td>
                      <Td className="tabular font-mono text-xs">
                        {cur ? `v${cur.version}` : "—"}
                        {sched.length ? <Badge tone="warning" className="ms-2">{t("admin.pricing.scheduled")}</Badge> : null}
                      </Td>
                      <Td className="text-xs whitespace-nowrap text-muted-foreground">
                        {cur ? t("admin.pricing.since", { date: formatDateTime(cur.effectiveFrom, locale, timeZone) }) : "—"}
                      </Td>
                      <Td>
                        <Badge tone={p.status === "ACTIVE" ? "success" : "danger"}>{t(`status.${p.status}`)}</Badge>
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          {manageable ? <ChangePriceDialog price={p} current={cur} /> : null}
                          <Button size="sm" variant="ghost" onClick={() => setExpanded(open ? null : p.id)} aria-expanded={open} aria-label={t("admin.pricing.history")}>
                            <History aria-hidden />
                            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                    {open ? (
                      <tr className="border-b bg-surface-2">
                        <td colSpan={7} className="px-3 py-2">
                          <ol className="grid gap-1">
                            {p.versions.map((v) => (
                              <li key={v.id} className="grid grid-cols-[3rem_8rem_1fr] items-baseline gap-3 text-xs sm:grid-cols-[3rem_8rem_18rem_1fr]">
                                <span className="font-mono">{`v${v.version}`}</span>
                                <span className="tabular font-medium">{formatMoney(v, locale)}</span>
                                <span className="text-muted-foreground">
                                  {formatDateTime(v.effectiveFrom, locale, timeZone)} → {v.effectiveTo ? formatDateTime(v.effectiveTo, locale, timeZone) : t("admin.pricing.open")}
                                </span>
                                <span className="hidden truncate text-muted-foreground sm:block">{v.reason}</span>
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <EntitlementsCard plan={plan} editable={scope.platform} />
    </div>
  );
}

function ChangePriceDialog({ price, current }: { price: PriceDTO; current?: PriceVersionDTO }) {
  const { t, locale } = useI18n();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const minor = parseMajorToMinor(amount, minorUnits(price.currency));

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {t("admin.pricing.changePrice")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("admin.pricing.changePrice")} description={t("admin.pricing.immutableNote")} closeLabel={t("common.close")}>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (minor === null) return;
            setBusy(true);
            setError(null);
            try {
              await act(`/api/v1/admin/prices/${price.id}/versions`, "POST", {
                amountMinor: minor.toString(),
                effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
                reason,
              });
              setOpen(false);
              setAmount("");
              setReason("");
              setEffectiveFrom("");
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {current ? (
            <p className="text-sm text-muted-foreground">
              {`v${current.version}`} · <span className="tabular font-medium text-foreground">{formatMoney(current, locale)}</span>
            </p>
          ) : null}
          <Field label={`${t("admin.pricing.newAmount")} (${price.currency})`} htmlFor="amount" hint={minor !== null ? formatMoney({ amountMinor: minor, currency: price.currency }, locale) : undefined}>
            <Input id="amount" inputMode="decimal" dir="ltr" required value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== "" && minor === null} />
          </Field>
          <Field label={t("admin.pricing.effectiveFrom")} htmlFor="effectiveFrom" hint={t("admin.pricing.effectiveNow")}>
            <Input id="effectiveFrom" type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
          <Field label={t("common.reason")} htmlFor="price-reason" hint={t("common.reasonHint")}>
            <Textarea id="price-reason" required placeholder={t("common.reasonPlaceholder")} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || minor === null || reason.trim().length < 3}>
              {t("admin.pricing.changePrice")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddPriceDialog({ plan, scope, options }: { plan: PlanDTO; scope: MarketScope; options: MarketOptions }) {
  const { t, locale } = useI18n();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [marketType, setMarketType] = useState<PriceDTO["marketType"]>(scope.platform ? "GLOBAL" : scope.regions.length ? "REGION" : "COUNTRY");
  const [marketCode, setMarketCode] = useState("");
  const [interval, setInterval] = useState<"MONTH" | "YEAR">("MONTH");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const codes =
    marketType === "REGION"
      ? options.regions.filter((r) => canManageMarket(scope, options, "REGION", r))
      : marketType === "COUNTRY"
        ? options.countries.filter((c) => canManageMarket(scope, options, "COUNTRY", c.code)).map((c) => c.code)
        : ["*"];
  const code = marketType === "GLOBAL" ? "*" : marketCode || codes[0] || "";
  const currencies = marketType === "COUNTRY" ? (options.countries.find((c) => c.code === code)?.currencies ?? []) : options.currencies;
  const cur = currencies.includes(currency) ? currency : (currencies[0] ?? "USD");
  const minor = parseMajorToMinor(amount, minorUnits(cur));
  const types = (["GLOBAL", "REGION", "COUNTRY"] as const).filter((x) => (x === "GLOBAL" ? scope.platform : true));

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus aria-hidden />
          {t("admin.pricing.addPrice")}
        </Button>
      </DialogTrigger>
      <DialogContent title={`${t("admin.pricing.addPrice")} · ${plan.name}`} closeLabel={t("common.close")}>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (minor === null) return;
            setBusy(true);
            setError(null);
            try {
              await act(`/api/v1/admin/plans/${plan.id}/prices`, "POST", { interval, marketType, marketCode: code, currency: cur, amountMinor: minor.toString(), reason });
              setOpen(false);
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("admin.pricing.market")} htmlFor="mt">
              <Select id="mt" value={marketType} onChange={(e) => (setMarketType(e.target.value as PriceDTO["marketType"]), setMarketCode(""))}>
                {types.map((x) => (
                  <option key={x} value={x}>
                    {t(`admin.pricing.marketTypes.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {marketType !== "GLOBAL" ? (
              <Field label={t("admin.pricing.marketCode")} htmlFor="mc">
                <Select id="mc" value={code} onChange={(e) => setMarketCode(e.target.value)}>
                  {codes.map((c) => (
                    <option key={c} value={c}>
                      {marketType === "COUNTRY" ? `${displayName(c, "region", locale)} (${c})` : c}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label={t("admin.pricing.interval")} htmlFor="iv">
              <Select id="iv" value={interval} onChange={(e) => setInterval(e.target.value as "MONTH" | "YEAR")}>
                <option value="MONTH">{t("settings.billing.interval.MONTH")}</option>
                <option value="YEAR">{t("settings.billing.interval.YEAR")}</option>
              </Select>
            </Field>
            <Field label={t("admin.pricing.currency")} htmlFor="cur">
              <Select id="cur" value={cur} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("admin.pricing.amount")} htmlFor="amt" hint={minor !== null ? formatMoney({ amountMinor: minor, currency: cur }, locale) : undefined}>
            <Input id="amt" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== "" && minor === null} />
          </Field>
          <Field label={t("common.reason")} htmlFor="add-reason" hint={t("common.reasonHint")}>
            <Textarea id="add-reason" value={reason} placeholder={t("common.reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {codes.length === 0 ? <Notice tone="warning">{t("admin.pricing.cannotManage")}</Notice> : null}
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || minor === null || !code || reason.trim().length < 3}>
              {t("common.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewPlanDialog() {
  const { t } = useI18n();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [trial, setTrial] = useState("0");
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={t("admin.pricing.newPlan")}>
          <Plus aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent title={t("admin.pricing.newPlan")} closeLabel={t("common.close")}>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await act("/api/v1/admin/plans", "POST", { key, name, defaultTrialDays: Number(trial) || 0 });
              setOpen(false);
            } catch (err) {
              setError(err);
            }
          }}
        >
          <Field label={t("admin.pricing.name")} htmlFor="pn">
            <Input id="pn" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("admin.pricing.key")} htmlFor="pk">
            <Input id="pk" dir="ltr" className="font-mono" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} />
          </Field>
          <Field label={t("admin.pricing.trialDays")} htmlFor="pt">
            <Input id="pt" type="number" min={0} max={365} value={trial} onChange={(e) => setTrial(e.target.value)} />
          </Field>
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={!key || !name}>
              {t("common.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EntitlementsCard({ plan, editable }: { plan: PlanDTO; editable: boolean }) {
  const { t } = useI18n();
  const act = useAction();
  const label = (k: string) => {
    const v = t(`pricing.features.${k}`);
    return v === `pricing.features.${k}` ? k : v;
  };
  return (
    <Card>
      <CardHeader title={t("admin.pricing.entitlements")} />
      <Table>
        <THead>
          <Tr>
            <Th>{t("admin.pricing.feature")}</Th>
            <Th>{t("common.status")}</Th>
            <Th>{t("admin.pricing.limit")}</Th>
            <Th>
              <span className="sr-only">{t("common.actions")}</span>
            </Th>
          </Tr>
        </THead>
        <TBody>
          {plan.entitlements.map((e) => (
            <Tr key={e.featureKey}>
              <Td>
                {label(e.featureKey)} <span className="font-mono text-[11px] text-muted-foreground">{e.featureKey}</span>
              </Td>
              <Td>{e.enabled ? <Badge tone="success">{t("common.enabled")}</Badge> : <Badge>{t("common.disabled")}</Badge>}</Td>
              <Td className="tabular font-mono text-xs">{e.limitValue ?? t("admin.pricing.noLimit")}</Td>
              <Td className="text-end">
                {editable ? (
                  <ReasonDialog
                    trigger={<Button size="sm" variant="ghost">{e.enabled ? t("admin.pricing.disable") : t("admin.pricing.activate")}</Button>}
                    title={`${label(e.featureKey)} · ${plan.name}`}
                    confirmLabel={e.enabled ? t("admin.pricing.disable") : t("admin.pricing.activate")}
                    onConfirm={(reason) =>
                      act(`/api/v1/admin/plans/${plan.id}/entitlements`, "PUT", { featureKey: e.featureKey, enabled: !e.enabled, limitValue: e.limitValue, reason })
                    }
                  />
                ) : null}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
