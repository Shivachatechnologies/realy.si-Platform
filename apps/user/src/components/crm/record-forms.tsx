"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { CustomFieldInputs, OwnerPicker, TagInput, useAction, type CustomFieldDef, type CustomValues, type Owner } from "./kit";

/** Create / edit forms for accounts, contacts and deals. */

export const ACCOUNT_TYPES = ["PROSPECT", "CUSTOMER", "PARTNER", "VENDOR", "OTHER"] as const;
export interface Option {
  id: string;
  name: string;
}
export interface StageOption {
  id: string;
  name: string;
  type: string;
}
export interface PipelineOption {
  id: string;
  name: string;
  stages: StageOption[];
}

const dupIds = (err: unknown, reason: string) => (err instanceof ApiError && err.details?.reason === reason ? ((err.details.ids as string[] | undefined) ?? []) : []);

function SourceInput({ id, value, onChange, sources }: { id: string; value: string; onChange: (v: string) => void; sources: string[] }) {
  const t = useT();
  return (
    <>
      <Input id={id} value={value} maxLength={100} list={`${id}-list`} placeholder={t("crm.sourcePlaceholder")} onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${id}-list`}>
        {sources.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

export function AccountForm({
  base,
  locale,
  owners,
  sources,
  fields,
  accountId,
  initial,
  defaultType = "PROSPECT",
  viewerId,
}: {
  base: string;
  locale: string;
  owners: Owner[];
  sources: string[];
  fields: CustomFieldDef[];
  accountId?: string;
  initial?: Partial<Record<"name" | "type" | "domain" | "website" | "industry" | "email" | "phone" | "countryCode" | "territory" | "source" | "ownerId" | "notes", string>> & { tags?: string[]; customFields?: CustomValues };
  defaultType?: (typeof ACCOUNT_TYPES)[number];
  viewerId?: string;
}) {
  const t = useT();
  const router = useRouter();
  const empty = {
    name: "",
    type: defaultType as string,
    domain: "",
    website: "",
    industry: "",
    email: "",
    phone: "",
    countryCode: "",
    territory: "",
    source: "",
    ownerId: viewerId && owners.some((o) => o.id === viewerId) ? viewerId : "",
    notes: "",
  };
  const start = { ...empty, ...initial };
  const [f, setF] = useState(start);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [custom, setCustom] = useState<CustomValues>(initial?.customFields ?? {});
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = (allowDuplicate: boolean) => {
    if (accountId) {
      const nul = (v: string) => v || null;
      return run(() =>
        api(`${base}/crm/accounts/${accountId}`, {
          method: "PATCH",
          body: {
            name: f.name,
            type: f.type,
            domain: nul(f.domain),
            website: nul(f.website),
            industry: nul(f.industry),
            email: nul(f.email),
            phone: nul(f.phone),
            countryCode: nul(f.countryCode),
            territory: nul(f.territory),
            source: nul(f.source),
            ownerId: nul(f.ownerId),
            notes: nul(f.notes),
            tags,
            customFields: custom,
          },
        }),
      );
    }
    return run(
      () => api<{ id: string }>(`${base}/crm/accounts`, { body: { ...f, tags, customFields: custom, allowDuplicate } }),
      (a) => router.push(`/${locale}/crm/accounts/${a.id}`),
    );
  };
  const dups = dupIds(error, "crm_account_duplicate");
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit(false);
      }}
      className="grid gap-3 p-3 sm:grid-cols-3"
    >
      <Field label={t("crm.fields.name")} htmlFor="acc-name">
        <Input id="acc-name" value={f.name} maxLength={200} required onChange={set("name")} />
      </Field>
      <Field label={t("crm.fields.type")} htmlFor="acc-type">
        <Select id="acc-type" value={f.type} onChange={set("type")}>
          {ACCOUNT_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`crm.accountTypes.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("crm.owner")} htmlFor="acc-owner">
        <OwnerPicker id="acc-owner" owners={owners} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} />
      </Field>
      <Field label={t("crm.fields.website")} htmlFor="acc-web">
        <Input id="acc-web" value={f.website} maxLength={300} placeholder="https://" onChange={set("website")} />
      </Field>
      <Field label={t("crm.fields.domain")} htmlFor="acc-domain">
        <Input id="acc-domain" value={f.domain} maxLength={200} placeholder="example.com" onChange={set("domain")} />
      </Field>
      <Field label={t("crm.fields.industry")} htmlFor="acc-industry">
        <Input id="acc-industry" value={f.industry} maxLength={100} onChange={set("industry")} />
      </Field>
      <Field label={t("crm.email")} htmlFor="acc-email">
        <Input id="acc-email" type="email" value={f.email} maxLength={254} onChange={set("email")} />
      </Field>
      <Field label={t("crm.phone")} htmlFor="acc-phone">
        <Input id="acc-phone" type="tel" value={f.phone} maxLength={40} onChange={set("phone")} />
      </Field>
      <Field label={t("crm.fields.country")} htmlFor="acc-country" hint={t("crm.fields.countryHint")}>
        <Input id="acc-country" value={f.countryCode} maxLength={2} onChange={set("countryCode")} />
      </Field>
      <Field label={t("crm.fields.territory")} htmlFor="acc-territory">
        <Input id="acc-territory" value={f.territory} maxLength={100} onChange={set("territory")} />
      </Field>
      <Field label={t("crm.source")} htmlFor="acc-source">
        <SourceInput id="acc-source" value={f.source} sources={sources} onChange={(v) => setF((p) => ({ ...p, source: v }))} />
      </Field>
      <Field label={t("crm.fields.tags")} htmlFor="acc-tags">
        <TagInput id="acc-tags" value={tags} onChange={setTags} />
      </Field>
      <CustomFieldInputs defs={fields} values={custom} onChange={setCustom} idPrefix="acc" />
      <div className="sm:col-span-3">
        <Field label={t("crm.notes")} htmlFor="acc-notes">
          <Textarea id="acc-notes" rows={2} value={f.notes} maxLength={5000} onChange={set("notes")} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy || !f.name.trim()}>
          {accountId ? null : <Plus aria-hidden />}
          {accountId ? t("common.save") : t("crm.accounts.add")}
        </Button>
        {dups.length ? (
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void submit(true)}>
              {t("crm.createAnyway")}
            </Button>
            {dups.map((id) => (
              <Link key={id} href={`/${locale}/crm/accounts/${id}`} className="text-xs text-muted-foreground hover:underline">
                {t("crm.viewExistingRecord")}
              </Link>
            ))}
          </>
        ) : null}
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ContactForm({
  base,
  locale,
  owners,
  accounts,
  fields,
  contactId,
  initial,
  viewerId,
}: {
  base: string;
  locale: string;
  owners: Owner[];
  accounts: Option[];
  fields: CustomFieldDef[];
  contactId?: string;
  initial?: Partial<Record<"firstName" | "lastName" | "email" | "phone" | "title" | "accountId" | "ownerId", string>> & { marketingConsent?: boolean; tags?: string[]; customFields?: CustomValues };
  viewerId?: string;
}) {
  const t = useT();
  const router = useRouter();
  const empty = { firstName: "", lastName: "", email: "", phone: "", title: "", accountId: "", ownerId: viewerId && owners.some((o) => o.id === viewerId) ? viewerId : "" };
  const [f, setF] = useState({ ...empty, ...initial });
  const [consent, setConsent] = useState(initial?.marketingConsent ?? false);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [custom, setCustom] = useState<CustomValues>(initial?.customFields ?? {});
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = (allowDuplicate: boolean) => {
    if (contactId) {
      const nul = (v: string) => v || null;
      return run(() =>
        api(`${base}/crm/contacts/${contactId}`, {
          method: "PATCH",
          body: { firstName: f.firstName, lastName: nul(f.lastName), email: nul(f.email), phone: nul(f.phone), title: nul(f.title), accountId: nul(f.accountId), ownerId: nul(f.ownerId), marketingConsent: consent, tags, customFields: custom },
        }),
      );
    }
    return run(
      () => api<{ id: string }>(`${base}/crm/contacts`, { body: { ...f, marketingConsent: consent, tags, customFields: custom, allowDuplicate } }),
      (c) => router.push(`/${locale}/crm/contacts/${c.id}`),
    );
  };
  const dups = dupIds(error, "crm_contact_duplicate");
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit(false);
      }}
      className="grid gap-3 p-3 sm:grid-cols-3"
    >
      <Field label={t("crm.fields.firstName")} htmlFor="ct-first">
        <Input id="ct-first" value={f.firstName} maxLength={100} required onChange={set("firstName")} />
      </Field>
      <Field label={t("crm.fields.lastName")} htmlFor="ct-last">
        <Input id="ct-last" value={f.lastName} maxLength={100} onChange={set("lastName")} />
      </Field>
      <Field label={t("crm.fields.jobTitle")} htmlFor="ct-title">
        <Input id="ct-title" value={f.title} maxLength={150} onChange={set("title")} />
      </Field>
      <Field label={t("crm.email")} htmlFor="ct-email">
        <Input id="ct-email" type="email" value={f.email} maxLength={254} onChange={set("email")} />
      </Field>
      <Field label={t("crm.phone")} htmlFor="ct-phone">
        <Input id="ct-phone" type="tel" value={f.phone} maxLength={40} onChange={set("phone")} />
      </Field>
      <Field label={t("crm.fields.account")} htmlFor="ct-account">
        <Select id="ct-account" value={f.accountId} onChange={set("accountId")}>
          <option value="">{t("common.none")}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("crm.owner")} htmlFor="ct-owner">
        <OwnerPicker id="ct-owner" owners={owners} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} />
      </Field>
      <Field label={t("crm.fields.tags")} htmlFor="ct-tags">
        <TagInput id="ct-tags" value={tags} onChange={setTags} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {t("crm.fields.marketingConsent")}
      </label>
      <CustomFieldInputs defs={fields} values={custom} onChange={setCustom} idPrefix="ct" />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy || !f.firstName.trim()}>
          {contactId ? null : <Plus aria-hidden />}
          {contactId ? t("common.save") : t("crm.contacts.add")}
        </Button>
        {dups.length ? (
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void submit(true)}>
              {t("crm.createAnyway")}
            </Button>
            {dups.map((id) => (
              <Link key={id} href={`/${locale}/crm/contacts/${id}`} className="text-xs text-muted-foreground hover:underline">
                {t("crm.viewExistingRecord")}
              </Link>
            ))}
          </>
        ) : null}
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function DealForm({
  base,
  locale,
  owners,
  accounts,
  contacts,
  pipelines,
  sources,
  fields,
  currency,
  dealId,
  initial,
  viewerId,
}: {
  base: string;
  locale: string;
  owners: Owner[];
  accounts: Option[];
  contacts: (Option & { accountId: string | null })[];
  pipelines: PipelineOption[];
  sources: string[];
  fields: CustomFieldDef[];
  currency: string;
  dealId?: string;
  initial?: Partial<Record<"name" | "accountId" | "contactId" | "ownerId" | "amount" | "currency" | "probability" | "expectedCloseDate" | "source" | "campaignCode" | "description", string>> & {
    tags?: string[];
    customFields?: CustomValues;
  };
  viewerId?: string;
}) {
  const t = useT();
  const router = useRouter();
  const empty = {
    name: "",
    accountId: "",
    contactId: "",
    ownerId: viewerId && owners.some((o) => o.id === viewerId) ? viewerId : "",
    pipelineId: pipelines[0]?.id ?? "",
    stageId: "",
    amount: "",
    currency,
    probability: "",
    expectedCloseDate: "",
    source: "",
    campaignCode: "",
    description: "",
  };
  const [f, setF] = useState({ ...empty, ...initial });
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [custom, setCustom] = useState<CustomValues>(initial?.customFields ?? {});
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const pipeline = pipelines.find((p) => p.id === f.pipelineId);
  const visibleContacts = f.accountId ? contacts.filter((c) => c.accountId === f.accountId || c.id === f.contactId) : contacts;
  const submit = () => {
    const probability = f.probability === "" ? undefined : Number(f.probability);
    if (dealId) {
      const nul = (v: string) => v || null;
      return run(() =>
        api(`${base}/crm/deals/${dealId}`, {
          method: "PATCH",
          body: {
            name: f.name,
            accountId: nul(f.accountId),
            contactId: nul(f.contactId),
            ownerId: nul(f.ownerId),
            amount: f.amount || null,
            currency: f.currency,
            probability: probability ?? null,
            expectedCloseDate: nul(f.expectedCloseDate),
            source: nul(f.source),
            campaignCode: nul(f.campaignCode),
            description: nul(f.description),
            tags,
            customFields: custom,
          },
        }),
      );
    }
    return run(
      () => api<{ id: string }>(`${base}/crm/deals`, { body: { ...f, probability, tags, customFields: custom } }),
      (d) => router.push(`/${locale}/crm/deals/${d.id}`),
    );
  };
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit();
      }}
      className="grid gap-3 p-3 sm:grid-cols-3"
    >
      <Field label={t("crm.fields.dealName")} htmlFor="deal-name">
        <Input id="deal-name" value={f.name} maxLength={200} required onChange={set("name")} />
      </Field>
      <Field label={t("crm.fields.account")} htmlFor="deal-account">
        <Select id="deal-account" value={f.accountId} onChange={set("accountId")}>
          <option value="">{t("common.none")}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("crm.fields.contact")} htmlFor="deal-contact">
        <Select id="deal-contact" value={f.contactId} onChange={set("contactId")}>
          <option value="">{t("common.none")}</option>
          {visibleContacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      {dealId ? null : (
        <>
          <Field label={t("crm.fields.pipeline")} htmlFor="deal-pipeline">
            <Select id="deal-pipeline" value={f.pipelineId} onChange={(e) => setF((p) => ({ ...p, pipelineId: e.target.value, stageId: "" }))}>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("crm.stage")} htmlFor="deal-stage">
            <Select id="deal-stage" value={f.stageId} onChange={set("stageId")}>
              <option value="">{t("crm.deals.firstStage")}</option>
              {pipeline?.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      <Field label={t("crm.owner")} htmlFor="deal-owner">
        <OwnerPicker id="deal-owner" owners={owners} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
        <Field label={t("crm.fields.amount")} htmlFor="deal-amount">
          <Input id="deal-amount" inputMode="decimal" pattern="\d{1,12}(\.\d{1,3})?" value={f.amount} onChange={set("amount")} />
        </Field>
        <Field label={t("crm.fields.currency")} htmlFor="deal-currency">
          <Input id="deal-currency" value={f.currency} maxLength={3} pattern="[A-Z]{3}" onChange={(e) => setF((p) => ({ ...p, currency: e.target.value.toUpperCase() }))} />
        </Field>
      </div>
      <Field label={t("crm.probability")} htmlFor="deal-prob" hint={t("crm.deals.probabilityHint")}>
        <Input id="deal-prob" type="number" min={0} max={100} step={1} value={f.probability} placeholder={t("crm.stageDefault")} onChange={set("probability")} />
      </Field>
      <Field label={t("crm.expectedClose")} htmlFor="deal-close">
        <Input id="deal-close" type="date" value={f.expectedCloseDate} onChange={set("expectedCloseDate")} />
      </Field>
      <Field label={t("crm.source")} htmlFor="deal-source">
        <SourceInput id="deal-source" value={f.source} sources={sources} onChange={(v) => setF((p) => ({ ...p, source: v }))} />
      </Field>
      <Field label={t("crm.fields.campaignCode")} htmlFor="deal-campaign">
        <Input id="deal-campaign" value={f.campaignCode} maxLength={100} onChange={set("campaignCode")} />
      </Field>
      <Field label={t("crm.fields.tags")} htmlFor="deal-tags">
        <TagInput id="deal-tags" value={tags} onChange={setTags} />
      </Field>
      <CustomFieldInputs defs={fields} values={custom} onChange={setCustom} idPrefix="deal" />
      <div className="sm:col-span-3">
        <Field label={t("crm.fields.description")} htmlFor="deal-desc">
          <Textarea id="deal-desc" rows={2} value={f.description} maxLength={5000} onChange={set("description")} />
        </Field>
      </div>
      <div className="sm:col-span-3">
        <Button type="submit" disabled={busy || !f.name.trim()}>
          {dealId ? null : <Plus aria-hidden />}
          {dealId ? t("common.save") : t("crm.deals.add")}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Stage buttons + won/lost controls for a deal. */
export function DealStageControls({ base, dealId, stages, stageId, status }: { base: string; dealId: string; stages: StageOption[]; stageId: string; status: string }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [losing, setLosing] = useState(false);
  const { busy, error, run } = useAction();
  const open = stages.filter((s) => s.type === "OPEN");
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("crm.stage")}>
        {open.map((s) => (
          <Button key={s.id} type="button" size="sm" variant={s.id === stageId ? "default" : "secondary"} disabled={busy || s.id === stageId} onClick={() => void run(() => api(`${base}/crm/deals/${dealId}/stage`, { body: { stageId: s.id } }))}>
            {s.name}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status === "OPEN" ? (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={() => void run(() => api(`${base}/crm/deals/${dealId}/close`, { body: { outcome: "won" } }))}>
              {t("crm.deals.markWon")}
            </Button>
            {losing ? (
              <form
                className="flex flex-wrap items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => api(`${base}/crm/deals/${dealId}/close`, { body: { outcome: "lost", lostReason: reason } }), () => setLosing(false));
                }}
              >
                <Input aria-label={t("crm.deals.lostReason")} className="h-8 w-56 text-xs" value={reason} maxLength={300} required placeholder={t("crm.deals.lostReason")} onChange={(e) => setReason(e.target.value)} />
                <Button type="submit" size="sm" variant="danger" disabled={busy || !reason.trim()}>
                  {t("crm.deals.markLost")}
                </Button>
              </form>
            ) : (
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setLosing(true)}>
                {t("crm.deals.markLost")}
              </Button>
            )}
          </>
        ) : (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(`${base}/crm/deals/${dealId}/close`, { body: { outcome: "reopen" } }))}>
            {t("crm.deals.reopen")}
          </Button>
        )}
      </div>
      <FormError error={error} />
    </div>
  );
}
