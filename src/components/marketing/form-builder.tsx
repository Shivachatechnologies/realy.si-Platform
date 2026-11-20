"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { splitList } from "./format";
import { useAction } from "./ui";

const TYPES = ["text", "email", "tel", "textarea", "select", "checkbox"] as const;

export interface BuilderField {
  key: string;
  label: string;
  type: (typeof TYPES)[number];
  required: boolean;
  options?: string[];
}
export interface FormValues {
  id?: string;
  name: string;
  title: string;
  description: string;
  submitLabel: string;
  successMessage: string;
  followUpHours: string;
  campaignId: string;
  fields: BuilderField[];
}

const keyFrom = (label: string, taken: string[]) => {
  const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 36) || "field";
  let k = /^[a-z]/.test(stem) ? stem : `f_${stem}`;
  let n = 2;
  while (taken.includes(k)) k = `${stem}_${n++}`;
  return k;
};

/** Lead-capture form builder: fields (type, label, required, options), copy, campaign attribution and CRM follow-up. */
export function FormBuilder({ base, locale, initial, campaigns }: { base: string; locale: string; initial: FormValues; campaigns: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState<FormValues>(initial);
  const { busy, error, run } = useAction();
  const editing = !!initial.id;
  const setField = (i: number, patch: Partial<BuilderField>) => setF((p) => ({ ...p, fields: p.fields.map((x, n) => (n === i ? { ...x, ...patch } : x)) }));
  const move = (i: number, d: -1 | 1) =>
    setF((p) => {
      const fields = [...p.fields];
      const j = i + d;
      if (j < 0 || j >= fields.length) return p;
      [fields[i], fields[j]] = [fields[j]!, fields[i]!];
      return { ...p, fields };
    });
  const hasEmail = f.fields.some((x) => x.type === "email");
  return (
    <form
      className="grid gap-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const body = {
          name: f.name,
          title: f.title,
          description: f.description,
          submitLabel: f.submitLabel,
          successMessage: f.successMessage,
          followUpHours: f.followUpHours === "" ? null : Number(f.followUpHours),
          campaignId: f.campaignId || null,
          fields: f.fields.map((x) => ({ key: x.key, label: x.label, type: x.type, required: x.required, ...(x.type === "select" ? { options: x.options ?? [] } : {}) })),
        };
        void run(
          () => (editing ? api(`${base}/forms/${initial.id}`, { method: "PATCH", body }) : api<{ id: string }>(`${base}/forms`, { body })),
          (r) => !editing && router.push(`/${locale}/marketing/forms/${(r as { id: string }).id}`),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("marketing.forms.name")} htmlFor="fb-name" hint={t("marketing.forms.nameHint")}>
          <Input id="fb-name" value={f.name} maxLength={120} required onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
        </Field>
        <Field label={t("marketing.forms.headline")} htmlFor="fb-title">
          <Input id="fb-title" value={f.title} maxLength={200} required onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} />
        </Field>
        <Field label={t("marketing.forms.description")} htmlFor="fb-desc" className="sm:col-span-2">
          <Textarea id="fb-desc" rows={2} value={f.description} maxLength={2000} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} />
        </Field>
        <Field label={t("marketing.forms.submitLabel")} htmlFor="fb-submit">
          <Input id="fb-submit" value={f.submitLabel} maxLength={60} placeholder={t("marketing.publicForm.submit")} onChange={(e) => setF((p) => ({ ...p, submitLabel: e.target.value }))} />
        </Field>
        <Field label={t("marketing.forms.successMessage")} htmlFor="fb-success">
          <Input id="fb-success" value={f.successMessage} maxLength={500} placeholder={t("marketing.publicForm.thanks")} onChange={(e) => setF((p) => ({ ...p, successMessage: e.target.value }))} />
        </Field>
        <Field label={t("marketing.campaigns.campaign")} htmlFor="fb-campaign" hint={t("marketing.forms.campaignHint")}>
          <Select id="fb-campaign" value={f.campaignId} onChange={(e) => setF((p) => ({ ...p, campaignId: e.target.value }))}>
            <option value="">{t("common.none")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("marketing.forms.followUpHours")} htmlFor="fb-follow" hint={t("marketing.forms.followUpHint")}>
          <Input id="fb-follow" type="number" min={1} max={1440} value={f.followUpHours} onChange={(e) => setF((p) => ({ ...p, followUpHours: e.target.value }))} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("marketing.forms.fields")}</legend>
        {f.fields.map((x, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto_auto]">
            <Input
              aria-label={t("marketing.forms.fieldLabel")}
              placeholder={t("marketing.forms.fieldLabel")}
              value={x.label}
              maxLength={120}
              required
              onChange={(e) => setField(i, { label: e.target.value, ...(editing ? {} : { key: keyFrom(e.target.value, f.fields.filter((_, n) => n !== i).map((y) => y.key)) }) })}
            />
            <Select aria-label={t("marketing.forms.fieldType")} value={x.type} onChange={(e) => setField(i, { type: e.target.value as BuilderField["type"] })}>
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`marketing.forms.types.${ty}`)}
                </option>
              ))}
            </Select>
            <code className="self-center truncate text-[11px] text-muted-foreground">{x.key}</code>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={x.required} onChange={(e) => setField(i, { required: e.target.checked })} />
              {t("marketing.forms.required")}
            </label>
            <div className="flex gap-1">
              <Button type="button" size="icon" variant="ghost" aria-label={t("marketing.forms.moveUp")} onClick={() => move(i, -1)}>
                <ArrowUp aria-hidden />
              </Button>
              <Button type="button" size="icon" variant="ghost" aria-label={t("marketing.forms.moveDown")} onClick={() => move(i, 1)}>
                <ArrowDown aria-hidden />
              </Button>
              <Button type="button" size="icon" variant="ghost" aria-label={t("marketing.common.delete")} onClick={() => setF((p) => ({ ...p, fields: p.fields.filter((_, n) => n !== i) }))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
            {x.type === "select" ? (
              <Input
                className="sm:col-span-5"
                aria-label={t("marketing.forms.options")}
                placeholder={t("marketing.forms.options")}
                defaultValue={(x.options ?? []).join(", ")}
                onBlur={(e) => setField(i, { options: splitList(e.target.value) })}
              />
            ) : null}
          </div>
        ))}
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={f.fields.length >= 30}
            onClick={() => setF((p) => ({ ...p, fields: [...p.fields, { key: keyFrom("field", p.fields.map((y) => y.key)), label: "", type: "text", required: false }] }))}
          >
            <Plus aria-hidden />
            {t("marketing.forms.addField")}
          </Button>
        </div>
        {!hasEmail ? <p className="text-xs text-danger">{t("marketing.forms.needsEmail")}</p> : null}
        <p className="text-xs text-muted-foreground">{t("marketing.forms.consentNote")}</p>
      </fieldset>
      <div>
        <Button type="submit" disabled={busy || !hasEmail || !f.name.trim() || !f.title.trim()}>
          {editing ? <Save aria-hidden /> : <Plus aria-hidden />}
          {editing ? t("common.save") : t("marketing.forms.create")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
