"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Search, ShieldCheck, Sparkles, UserSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAction } from "../kit";

/**
 * Plain-language setup of a prospecting autopilot in five short steps: who → which people → the message → safety
 * limits → review. Also used to edit an existing autopilot (PATCH). Nothing runs until the person turns it on.
 */

export const SENIORITY_OPTIONS = ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry"] as const;
const AUTONOMY = ["DRAFT_ONLY", "REVIEW", "AUTO_SEND"] as const;
const CONSENT = ["legitimate_interest", "consent", "existing_relationship"] as const;

export interface AutopilotForm {
  name: string;
  audience: string;
  pitch: string;
  regions: string[];
  roles: string[];
  seniorities: string[];
  exclusions: string[];
  targetDomains: string[];
  dailyQuota: number;
  dailySendCap: number;
  peoplePerCompany: number;
  autonomy: (typeof AUTONOMY)[number];
  allowUnverified: boolean;
  unverifiedDailyCap: number;
  consentBasis: (typeof CONSENT)[number];
  consentNote: string;
  firstSubject: string;
  firstBody: string;
  unsubscribeLine: string;
  followUps: { delayDays: number; subject: string; body: string }[];
}

const toList = (v: string) => [...new Set(v.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))];
const fromList = (v: string[]) => v.join(", ");

function Step({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  return (
    <li className={cn("flex items-center gap-2 text-xs", active ? "font-semibold text-foreground" : "text-muted-foreground")} aria-current={active ? "step" : undefined}>
      <span className={cn("grid size-6 place-items-center rounded-full border text-[11px] tabular-nums", active ? "border-primary bg-primary text-primary-foreground" : done ? "border-success/40 bg-success/10 text-success" : "")}>{done ? <Check className="size-3" aria-hidden /> : n}</span>
      <span className="hidden sm:inline">{label}</span>
    </li>
  );
}

function Choice({ checked, onChange, title, text, name, value, badge }: { checked: boolean; onChange: () => void; title: string; text: string; name: string; value: string; badge?: ReactNode }) {
  return (
    <label className={cn("grid cursor-pointer gap-1 rounded-lg border p-3 text-sm transition-colors", checked ? "border-primary bg-accent/40" : "hover:bg-muted/50")}>
      <span className="flex items-center gap-2 font-medium">
        <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="accent-[var(--primary)]" />
        {title}
        {badge}
      </span>
      <span className="ps-6 text-xs text-muted-foreground">{text}</span>
    </label>
  );
}

interface LookupPerson {
  fullName: string;
  title: string | null;
  email: string | null;
  emailStatus: string;
  emailSource: string | null;
}

export function AutopilotWizard({ base, locale, initial, autopilotId, hasContactProvider, onDone }: { base: string; locale: string; initial?: Partial<AutopilotForm>; autopilotId?: string; hasContactProvider: boolean; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const lookup = useAction();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<AutopilotForm>(() => ({
    name: "",
    audience: "",
    pitch: "",
    regions: [],
    roles: [],
    seniorities: ["owner", "founder", "c_suite"],
    exclusions: [],
    targetDomains: [],
    dailyQuota: 10,
    dailySendCap: 20,
    peoplePerCompany: 2,
    autonomy: "REVIEW",
    allowUnverified: false,
    unverifiedDailyCap: 3,
    consentBasis: "legitimate_interest",
    consentNote: "",
    firstSubject: "",
    firstBody: "",
    unsubscribeLine: t("crm.prospecting.wizard.defaults.unsubscribe"),
    followUps: [
      { delayDays: 3, subject: t("crm.prospecting.wizard.defaults.fu1Subject"), body: t("crm.prospecting.wizard.defaults.fu1Body") },
      { delayDays: 5, subject: t("crm.prospecting.wizard.defaults.fu2Subject"), body: t("crm.prospecting.wizard.defaults.fu2Body") },
    ],
    ...initial,
  }));
  const [text, setText] = useState(() => ({ regions: fromList(initial?.regions ?? []), roles: fromList(initial?.roles ?? []), exclusions: fromList(initial?.exclusions ?? []), targetDomains: (initial?.targetDomains ?? []).join("\n") }));
  const [tryDomain, setTryDomain] = useState("");
  const [found, setFound] = useState<{ provider: string; people: LookupPerson[] } | null>(null);
  const set = <K extends keyof AutopilotForm>(k: K, v: AutopilotForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const steps = ["who", "people", "message", "safety", "review"] as const;
  const canNext = step === 0 ? f.name.trim().length > 0 && f.audience.trim().length >= 3 : step === 1 ? f.roles.length > 0 || f.seniorities.length > 0 : true;
  const unverifiedTooHigh = f.allowUnverified && f.unverifiedDailyCap >= f.dailySendCap;

  const payload = () => ({
    ...f,
    regions: toList(text.regions),
    roles: toList(text.roles),
    exclusions: toList(text.exclusions),
    targetDomains: toList(text.targetDomains),
    unverifiedDailyCap: f.allowUnverified ? f.unverifiedDailyCap : 0,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step < steps.length - 1) {
      if (canNext) setStep(step + 1);
      return;
    }
    void run(
      () => (autopilotId ? api(`${base}/crm/prospecting/${autopilotId}`, { method: "PATCH", body: payload() }) : api<{ id: string }>(`${base}/crm/prospecting`, { body: payload() })),
      (r) => {
        onDone?.();
        const id = (r as { id?: string } | undefined)?.id ?? autopilotId;
        if (id) router.replace(`/${locale}/crm/prospecting?autopilot=${id}`);
      },
    );
  };
  const tryIt = () => {
    void lookup.run(
      () => api<{ provider: string; people: LookupPerson[] }>(`${base}/crm/prospecting/lookup`, { body: { domain: tryDomain, roles: toList(text.roles), seniorities: f.seniorities } }),
      (r) => setFound(r),
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4" aria-busy={busy}>
      <ol className="flex flex-wrap items-center gap-3" aria-label={t("crm.prospecting.wizard.progress")}>
        {steps.map((s, i) => (
          <Step key={s} n={i + 1} active={i === step} done={i < step} label={t(`crm.prospecting.wizard.steps.${s}`)} />
        ))}
      </ol>

      {step === 0 ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t("crm.prospecting.wizard.whoIntro")}</p>
          <Field label={t("crm.prospecting.wizard.name")} htmlFor="ap-name" hint={t("crm.prospecting.wizard.nameHint")}>
            <Input id="ap-name" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} required placeholder={t("crm.prospecting.wizard.namePlaceholder")} />
          </Field>
          <Field label={t("crm.prospecting.wizard.audience")} htmlFor="ap-aud" hint={t("crm.prospecting.wizard.audienceHint")}>
            <Input id="ap-aud" value={f.audience} onChange={(e) => set("audience", e.target.value)} minLength={3} maxLength={300} required placeholder={t("crm.rev.discover.audiencePlaceholder")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("crm.prospecting.wizard.regions")} htmlFor="ap-reg" hint={t("crm.prospecting.wizard.listHint")}>
              <Input id="ap-reg" value={text.regions} onChange={(e) => setText((x) => ({ ...x, regions: e.target.value }))} maxLength={800} placeholder={t("crm.prospecting.wizard.regionsPlaceholder")} />
            </Field>
            <Field label={t("crm.prospecting.wizard.exclusions")} htmlFor="ap-exc" hint={t("crm.prospecting.wizard.exclusionsHint")}>
              <Input id="ap-exc" value={text.exclusions} onChange={(e) => setText((x) => ({ ...x, exclusions: e.target.value }))} maxLength={4000} placeholder={t("crm.prospecting.wizard.exclusionsPlaceholder")} />
            </Field>
          </div>
          <Field label={t("crm.prospecting.wizard.targets")} htmlFor="ap-tgt" hint={t("crm.prospecting.wizard.targetsHint")}>
            <Textarea id="ap-tgt" rows={3} value={text.targetDomains} onChange={(e) => setText((x) => ({ ...x, targetDomains: e.target.value }))} maxLength={20_000} placeholder={"acme.com\nexample.org"} />
          </Field>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t("crm.prospecting.wizard.peopleIntro")}</p>
          <Field label={t("crm.prospecting.wizard.roles")} htmlFor="ap-roles" hint={t("crm.prospecting.wizard.listHint")}>
            <Input id="ap-roles" value={text.roles} onChange={(e) => { setText((x) => ({ ...x, roles: e.target.value })); set("roles", toList(e.target.value)); }} maxLength={800} placeholder={t("crm.prospecting.wizard.rolesPlaceholder")} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="text-[13px] font-medium">{t("crm.prospecting.wizard.seniority")}</legend>
            <div className="flex flex-wrap gap-2">
              {SENIORITY_OPTIONS.map((s) => {
                const on = f.seniorities.includes(s);
                return (
                  <button key={s} type="button" aria-pressed={on} onClick={() => set("seniorities", on ? f.seniorities.filter((x) => x !== s) : [...f.seniorities, s])} className={cn("rounded-full border px-3 py-1 text-xs pointer-coarse:min-h-11", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    {t(`crm.prospecting.seniority.${s}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Field label={t("crm.prospecting.wizard.perCompany")} htmlFor="ap-per" hint={t("crm.prospecting.wizard.perCompanyHint")}>
            <Input id="ap-per" type="number" min={1} max={5} value={f.peoplePerCompany} onChange={(e) => set("peoplePerCompany", Math.min(5, Math.max(1, Number(e.target.value) || 1)))} className="w-24" />
          </Field>
          <section className="grid gap-2 rounded-lg border border-dashed p-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <UserSearch className="size-4 text-primary" aria-hidden />
              {t("crm.prospecting.wizard.tryTitle")}
            </h3>
            {hasContactProvider ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Input aria-label={t("crm.prospecting.wizard.tryDomain")} value={tryDomain} onChange={(e) => setTryDomain(e.target.value)} placeholder="acme.com" className="max-w-xs" maxLength={253} />
                  <Button type="button" variant="secondary" onClick={tryIt} disabled={lookup.busy || tryDomain.trim().length < 3} aria-busy={lookup.busy}>
                    <Search aria-hidden />
                    {lookup.busy ? t("crm.rev.working") : t("crm.prospecting.wizard.tryButton")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("crm.prospecting.wizard.tryHint")}</p>
                <FormError error={lookup.error} />
                {found ? (
                  found.people.length ? (
                    <ul className="grid gap-1 text-sm">
                      {found.people.map((p, i) => (
                        <li key={`${p.fullName}-${i}`} className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{p.fullName}</span>
                          {p.title ? <span className="text-muted-foreground">· {p.title}</span> : null}
                          <EmailBadge status={p.emailStatus} email={p.email} />
                        </li>
                      ))}
                      <li className="text-xs text-muted-foreground">{t("crm.prospecting.wizard.trySource", { provider: found.provider })}</li>
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("crm.prospecting.wizard.tryNone", { provider: found.provider })}</p>
                  )
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("crm.prospecting.wizard.tryNeedsProvider")}</p>
            )}
          </section>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t("crm.prospecting.wizard.messageIntro")}</p>
          <Field label={t("crm.prospecting.wizard.pitch")} htmlFor="ap-pitch" hint={t("crm.prospecting.wizard.pitchHint")}>
            <Textarea id="ap-pitch" rows={3} value={f.pitch} onChange={(e) => set("pitch", e.target.value)} maxLength={2000} placeholder={t("crm.prospecting.wizard.pitchPlaceholder")} />
          </Field>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("crm.prospecting.wizard.templateTitle")}</summary>
            <div className="mt-3 grid gap-3">
              <p className="text-xs text-muted-foreground">{t("crm.prospecting.wizard.templateHint")}</p>
              <Field label={t("crm.prospecting.wizard.subject")} htmlFor="ap-fs">
                <Input id="ap-fs" value={f.firstSubject} onChange={(e) => set("firstSubject", e.target.value)} maxLength={200} />
              </Field>
              <Field label={t("crm.prospecting.wizard.body")} htmlFor="ap-fb">
                <Textarea id="ap-fb" rows={5} value={f.firstBody} onChange={(e) => set("firstBody", e.target.value)} maxLength={5000} />
              </Field>
            </div>
          </details>
          <fieldset className="grid gap-3">
            <legend className="text-[13px] font-medium">{t("crm.prospecting.wizard.followUps")}</legend>
            <p className="text-xs text-muted-foreground">{t("crm.prospecting.wizard.followUpsHint")}</p>
            {f.followUps.map((fu, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t("crm.prospecting.wizard.afterDays")} htmlFor={`ap-fu-d-${i}`}>
                    <Input id={`ap-fu-d-${i}`} type="number" min={1} max={30} value={fu.delayDays} className="w-24" onChange={(e) => set("followUps", f.followUps.map((x, j) => (j === i ? { ...x, delayDays: Math.min(30, Math.max(1, Number(e.target.value) || 1)) } : x)))} />
                  </Field>
                  <Button type="button" variant="ghost" size="sm" onClick={() => set("followUps", f.followUps.filter((_, j) => j !== i))}>
                    {t("crm.prospecting.wizard.removeStep")}
                  </Button>
                </div>
                <Input aria-label={t("crm.prospecting.wizard.subject")} value={fu.subject} maxLength={200} onChange={(e) => set("followUps", f.followUps.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)))} />
                <Textarea aria-label={t("crm.prospecting.wizard.body")} rows={3} value={fu.body} maxLength={5000} onChange={(e) => set("followUps", f.followUps.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
              </div>
            ))}
            {f.followUps.length < 4 ? (
              <Button type="button" variant="secondary" size="sm" className="justify-self-start" onClick={() => set("followUps", [...f.followUps, { delayDays: 4, subject: t("crm.prospecting.wizard.defaults.fu2Subject"), body: t("crm.prospecting.wizard.defaults.fu2Body") }])}>
                {t("crm.prospecting.wizard.addStep")}
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("crm.prospecting.wizard.mergeFields")}</p>
          </fieldset>
          <Field label={t("crm.prospecting.wizard.unsubscribeLine")} htmlFor="ap-unsub" hint={t("crm.prospecting.wizard.unsubscribeHint")}>
            <Input id="ap-unsub" value={f.unsubscribeLine} onChange={(e) => set("unsubscribeLine", e.target.value)} maxLength={200} />
          </Field>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t("crm.prospecting.wizard.safetyIntro")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("crm.prospecting.wizard.quota")} htmlFor="ap-q" hint={t("crm.prospecting.wizard.quotaHint")}>
              <Input id="ap-q" type="number" min={1} max={100} value={f.dailyQuota} onChange={(e) => set("dailyQuota", Math.min(100, Math.max(1, Number(e.target.value) || 1)))} />
            </Field>
            <Field label={t("crm.prospecting.wizard.sendCap")} htmlFor="ap-cap" hint={t("crm.prospecting.wizard.sendCapHint")}>
              <Input id="ap-cap" type="number" min={1} max={200} value={f.dailySendCap} onChange={(e) => set("dailySendCap", Math.min(200, Math.max(1, Number(e.target.value) || 1)))} />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-[13px] font-medium">{t("crm.prospecting.wizard.autonomy")}</legend>
            {AUTONOMY.map((a) => (
              <Choice key={a} name="ap-autonomy" value={a} checked={f.autonomy === a} onChange={() => set("autonomy", a)} title={t(`crm.prospecting.autonomy.${a}`)} text={t(`crm.prospecting.autonomyHelp.${a}`)} badge={a === "REVIEW" ? <Badge tone="accent">{t("crm.prospecting.wizard.recommended")}</Badge> : null} />
            ))}
          </fieldset>
          <section className="grid gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={f.allowUnverified} onChange={(e) => set("allowUnverified", e.target.checked)} className="mt-1 accent-[var(--primary)]" />
              <span className="grid gap-0.5">
                <span className="font-medium">{t("crm.prospecting.wizard.allowUnverified")}</span>
                <span className="text-xs text-muted-foreground">{t("crm.prospecting.wizard.allowUnverifiedHint")}</span>
              </span>
            </label>
            {f.allowUnverified ? (
              <Field label={t("crm.prospecting.wizard.unverifiedCap")} htmlFor="ap-ucap" error={unverifiedTooHigh ? t("crm.prospecting.wizard.unverifiedCapTooHigh") : undefined} hint={t("crm.prospecting.wizard.unverifiedCapHint")}>
                <Input id="ap-ucap" type="number" min={0} max={10} value={f.unverifiedDailyCap} className="w-24" onChange={(e) => set("unverifiedDailyCap", Math.min(10, Math.max(0, Number(e.target.value) || 0)))} />
              </Field>
            ) : null}
          </section>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("crm.prospecting.wizard.consent")} htmlFor="ap-consent" hint={t("crm.prospecting.wizard.consentHint")}>
              <Select id="ap-consent" value={f.consentBasis} onChange={(e) => set("consentBasis", e.target.value as AutopilotForm["consentBasis"])}>
                {CONSENT.map((c) => (
                  <option key={c} value={c}>
                    {t(`crm.prospecting.consent.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("crm.prospecting.wizard.consentNote")} htmlFor="ap-cnote">
              <Input id="ap-cnote" value={f.consentNote} onChange={(e) => set("consentNote", e.target.value)} maxLength={500} placeholder={t("crm.prospecting.wizard.consentNotePlaceholder")} />
            </Field>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid gap-3 text-sm">
          <h3 className="flex items-center gap-2 font-display text-lg">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            {t("crm.prospecting.wizard.reviewTitle")}
          </h3>
          <dl className="grid gap-2 sm:grid-cols-2">
            <Row label={t("crm.prospecting.wizard.audience")} value={f.audience} />
            <Row label={t("crm.prospecting.wizard.regions")} value={fromList(toList(text.regions)) || t("crm.prospecting.any")} />
            <Row label={t("crm.prospecting.wizard.roles")} value={[fromList(toList(text.roles)), f.seniorities.map((s) => t(`crm.prospecting.seniority.${s}`)).join(", ")].filter(Boolean).join(" · ") || t("crm.prospecting.any")} />
            <Row label={t("crm.prospecting.wizard.limits")} value={t("crm.prospecting.wizard.limitsValue", { quota: f.dailyQuota, cap: f.dailySendCap })} />
            <Row label={t("crm.prospecting.wizard.autonomy")} value={t(`crm.prospecting.autonomy.${f.autonomy}`)} />
            <Row label={t("crm.prospecting.wizard.emails")} value={f.allowUnverified ? t("crm.prospecting.wizard.emailsUnverified", { cap: f.unverifiedDailyCap }) : t("crm.prospecting.wizard.emailsVerified")} />
            <Row label={t("crm.prospecting.wizard.consent")} value={t(`crm.prospecting.consent.${f.consentBasis}`)} />
            <Row label={t("crm.prospecting.wizard.followUps")} value={t("crm.prospecting.wizard.followUpsValue", { count: f.followUps.length })} />
          </dl>
          <p className="flex items-start gap-2 rounded-lg bg-accent/40 p-3 text-xs">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            {t("crm.prospecting.wizard.reviewNote")}
          </p>
        </div>
      ) : null}

      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-2">
        {step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
            <ArrowLeft aria-hidden className="rtl:rotate-180" />
            {t("crm.back")}
          </Button>
        ) : null}
        {step < steps.length - 1 ? (
          <Button type="submit" disabled={!canNext}>
            {t("crm.next")}
            <ArrowRight aria-hidden className="rtl:rotate-180" />
          </Button>
        ) : (
          <Button type="submit" variant="luminous" disabled={busy || unverifiedTooHigh} aria-busy={busy}>
            <Check aria-hidden />
            {autopilotId ? t("crm.prospecting.wizard.save") : t("crm.prospecting.wizard.create")}
          </Button>
        )}
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg border p-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export function EmailBadge({ status, email }: { status: string; email: string | null }) {
  const t = useT();
  const tone = status === "VERIFIED" ? "success" : status === "INVALID" ? "danger" : status === "NONE" ? "neutral" : "warning";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {email ? <span className="font-mono text-xs" dir="ltr">{email}</span> : null}
      <Badge tone={tone}>{t(`crm.prospecting.email.${status}`)}</Badge>
    </span>
  );
}
