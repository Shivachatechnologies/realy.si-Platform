"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { CustomFieldInputs, OwnerPicker, TagInput, useAction, type CustomFieldDef, type CustomValues, type Owner } from "./kit";
import type { Option, PipelineOption } from "./record-forms";

/** Lead qualification (BANT), details editing (incl. tags and custom fields) and conversion. */

export function QualificationForm({ base, leadId, initial }: { base: string; leadId: string; initial: { budget: string; authority: string; need: string; timeline: string; qualified: boolean } }) {
  const t = useT();
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAction();
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (k: "budget" | "authority" | "need" | "timeline") => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/leads/${leadId}`, { method: "PATCH", body: { budget: f.budget || null, authority: f.authority || null, need: f.need || null, timeline: f.timeline || null, qualified: f.qualified } }));
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <Field label={t("crm.bant.budget")} htmlFor="q-budget" hint={t("crm.bant.budgetHint")}>
        <Input id="q-budget" value={f.budget} maxLength={500} onChange={set("budget")} />
      </Field>
      <Field label={t("crm.bant.authority")} htmlFor="q-authority" hint={t("crm.bant.authorityHint")}>
        <Input id="q-authority" value={f.authority} maxLength={500} onChange={set("authority")} />
      </Field>
      <Field label={t("crm.bant.need")} htmlFor="q-need" hint={t("crm.bant.needHint")}>
        <Textarea id="q-need" rows={2} value={f.need} maxLength={1000} onChange={set("need")} />
      </Field>
      <Field label={t("crm.bant.timeline")} htmlFor="q-timeline" hint={t("crm.bant.timelineHint")}>
        <Input id="q-timeline" value={f.timeline} maxLength={500} onChange={set("timeline")} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={f.qualified} onChange={(e) => setF((p) => ({ ...p, qualified: e.target.checked }))} />
        {t("crm.bant.qualified")}
      </label>
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={busy || !dirty}>
          {t("common.save")}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function LeadDetailsForm({
  base,
  leadId,
  sources,
  fields,
  initial,
}: {
  base: string;
  leadId: string;
  sources: string[];
  fields: CustomFieldDef[];
  initial: { name: string; email: string; phone: string; account: string; source: string; territory: string; campaignCode: string; tags: string[]; customFields: CustomValues };
}) {
  const t = useT();
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAction();
  const set = (k: "name" | "email" | "phone" | "account" | "source" | "territory" | "campaignCode") => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const nul = (v: string) => v || null;
        void run(() =>
          api(`${base}/leads/${leadId}`, {
            method: "PATCH",
            body: { name: f.name, email: nul(f.email), phone: nul(f.phone), account: nul(f.account), source: nul(f.source), territory: nul(f.territory), campaignCode: nul(f.campaignCode), tags: f.tags, customFields: f.customFields },
          }),
        );
      }}
      className="grid gap-3 pt-3 sm:grid-cols-3"
    >
      <Field label={t("crm.name")} htmlFor="ld-name">
        <Input id="ld-name" value={f.name} maxLength={200} required onChange={set("name")} />
      </Field>
      <Field label={t("crm.email")} htmlFor="ld-email">
        <Input id="ld-email" type="email" value={f.email} maxLength={254} onChange={set("email")} />
      </Field>
      <Field label={t("crm.phone")} htmlFor="ld-phone">
        <Input id="ld-phone" type="tel" value={f.phone} maxLength={40} onChange={set("phone")} />
      </Field>
      <Field label={t("crm.account")} htmlFor="ld-account">
        <Input id="ld-account" value={f.account} maxLength={200} onChange={set("account")} />
      </Field>
      <Field label={t("crm.source")} htmlFor="ld-source">
        <Input id="ld-source" value={f.source} maxLength={100} list="ld-source-list" onChange={set("source")} />
        <datalist id="ld-source-list">
          {sources.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label={t("crm.fields.territory")} htmlFor="ld-territory">
        <Input id="ld-territory" value={f.territory} maxLength={100} onChange={set("territory")} />
      </Field>
      <Field label={t("crm.fields.campaignCode")} htmlFor="ld-campaign">
        <Input id="ld-campaign" value={f.campaignCode} maxLength={100} onChange={set("campaignCode")} />
      </Field>
      <Field label={t("crm.fields.tags")} htmlFor="ld-tags">
        <TagInput id="ld-tags" value={f.tags} onChange={(tags) => setF((p) => ({ ...p, tags }))} />
      </Field>
      <CustomFieldInputs defs={fields} values={f.customFields} onChange={(customFields) => setF((p) => ({ ...p, customFields }))} idPrefix="ld" />
      <div className="sm:col-span-3">
        <Button type="submit" variant="secondary" disabled={busy || !f.name.trim()}>
          {t("common.save")}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ConvertLeadForm({
  base,
  locale,
  leadId,
  owners,
  accounts,
  pipelines,
  defaults,
}: {
  base: string;
  locale: string;
  leadId: string;
  owners: Owner[];
  accounts: Option[];
  pipelines: PipelineOption[];
  defaults: { accountName: string; dealName: string; amount: string; ownerId: string };
}) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ accountId: "", accountName: defaults.accountName, accountType: "CUSTOMER", createDeal: true, dealName: defaults.dealName, amount: defaults.amount, pipelineId: pipelines[0]?.id ?? "", stageId: "", ownerId: defaults.ownerId });
  const { busy, error, run } = useAction();
  const pipeline = pipelines.find((p) => p.id === f.pipelineId);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () => api<{ contactId: string; dealId: string | null }>(`${base}/leads/${leadId}/convert`, { body: f }),
          (r) => router.push(r.dealId ? `/${locale}/crm/deals/${r.dealId}` : `/${locale}/crm/contacts/${r.contactId}`),
        );
      }}
      className="grid gap-3 sm:grid-cols-3"
    >
      <Field label={t("crm.convert.existingAccount")} htmlFor="cv-account">
        <Select id="cv-account" value={f.accountId} onChange={(e) => setF((p) => ({ ...p, accountId: e.target.value }))}>
          <option value="">{t("crm.convert.newAccount")}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      {f.accountId ? null : (
        <>
          <Field label={t("crm.convert.accountName")} htmlFor="cv-account-name">
            <Input id="cv-account-name" value={f.accountName} maxLength={200} onChange={(e) => setF((p) => ({ ...p, accountName: e.target.value }))} />
          </Field>
          <Field label={t("crm.fields.type")} htmlFor="cv-type">
            <Select id="cv-type" value={f.accountType} onChange={(e) => setF((p) => ({ ...p, accountType: e.target.value }))}>
              {(["CUSTOMER", "PROSPECT", "PARTNER"] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`crm.accountTypes.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      <Field label={t("crm.owner")} htmlFor="cv-owner">
        <OwnerPicker id="cv-owner" owners={owners} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2">
        <input type="checkbox" className="size-4 accent-primary" checked={f.createDeal} onChange={(e) => setF((p) => ({ ...p, createDeal: e.target.checked }))} />
        {t("crm.convert.createDeal")}
      </label>
      {f.createDeal ? (
        <>
          <Field label={t("crm.fields.dealName")} htmlFor="cv-deal">
            <Input id="cv-deal" value={f.dealName} maxLength={200} onChange={(e) => setF((p) => ({ ...p, dealName: e.target.value }))} />
          </Field>
          <Field label={t("crm.fields.amount")} htmlFor="cv-amount">
            <Input id="cv-amount" inputMode="decimal" pattern="\d{1,12}(\.\d{1,3})?" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} />
          </Field>
          <Field label={t("crm.fields.pipeline")} htmlFor="cv-pipeline">
            <Select id="cv-pipeline" value={f.pipelineId} onChange={(e) => setF((p) => ({ ...p, pipelineId: e.target.value, stageId: "" }))}>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("crm.stage")} htmlFor="cv-stage">
            <Select id="cv-stage" value={f.stageId} onChange={(e) => setF((p) => ({ ...p, stageId: e.target.value }))}>
              <option value="">{t("crm.deals.firstStage")}</option>
              {pipeline?.stages
                .filter((s) => s.type === "OPEN")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
        </>
      ) : null}
      <div className="sm:col-span-3">
        <Button type="submit" disabled={busy}>
          <ArrowRightLeft aria-hidden />
          {t("crm.convert.submit")}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}
