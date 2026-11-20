"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Template = "employment_verification" | "experience" | "welcome" | "role_change" | "warning";
type Extra = "details" | "newTitle" | "effectiveDate" | "endDate";

/**
 * Guided HR letter generator: pick a person, pick a letter (each explained in plain words), fill the one or two extra
 * details it needs, and the letter is generated from the employee record and stored with their documents.
 */
export function DocGenerator({
  endpoint,
  viewBase,
  people,
  templates,
  defaultEmployeeId,
}: {
  endpoint: string;
  /** Document download base: `${viewBase}/${id}?view=1` opens the generated letter. */
  viewBase: string;
  people: { value: string; label: string }[];
  templates: { key: Template; fields: Extra[] }[];
  defaultEmployeeId?: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [template, setTemplate] = useState<Template>(templates[0]!.key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const fields = templates.find((x) => x.key === template)?.fields ?? [];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setCreated(null);
    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = { template };
    for (const k of ["employeeId", "locale", ...fields]) {
      const v = String(form.get(k) ?? "").trim();
      if (v) body[k] = v;
    }
    setBusy(true);
    try {
      const doc = await api<{ id: string; name: string }>(endpoint, { method: "POST", body });
      setCreated(doc);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors());
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!people.length) return <p className="text-sm text-muted-foreground">{t("hr.docgen.noPeople")}</p>;

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={t("hr.docgen.who")} htmlFor="docgen-employee" error={fieldErrors.employeeId}>
        <Select id="docgen-employee" name="employeeId" required defaultValue={defaultEmployeeId ?? ""}>
          <option value="" disabled>
            {t("hr.docgen.pickPerson")}
          </option>
          {people.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("hr.docgen.which")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.map((x) => (
            <label
              key={x.key}
              className={cn(
                "grid min-h-11 cursor-pointer gap-0.5 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                template === x.key ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <input type="radio" name="template" value={x.key} checked={template === x.key} onChange={() => setTemplate(x.key)} className="sr-only" />
              <span className="font-medium">{t(`hr.docgen.tpl.${x.key}.name`)}</span>
              <span className="text-xs text-muted-foreground">{t(`hr.docgen.tpl.${x.key}.when`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.includes("newTitle") ? (
          <Field label={t("hr.docgen.newTitle")} htmlFor="docgen-title" error={fieldErrors.newTitle}>
            <Input id="docgen-title" name="newTitle" required maxLength={160} />
          </Field>
        ) : null}
        {fields.includes("effectiveDate") ? (
          <Field label={t("hr.effectiveDate")} htmlFor="docgen-effective" error={fieldErrors.effectiveDate}>
            <Input id="docgen-effective" name="effectiveDate" type="date" />
          </Field>
        ) : null}
        {fields.includes("endDate") ? (
          <Field label={t("hr.docgen.lastDay")} htmlFor="docgen-end" error={fieldErrors.endDate} hint={t("hr.docgen.lastDayHint")}>
            <Input id="docgen-end" name="endDate" type="date" />
          </Field>
        ) : null}
        <Field label={t("hr.docgen.language")} htmlFor="docgen-locale">
          <Select id="docgen-locale" name="locale" defaultValue={locale}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {fields.includes("details") ? (
        <Field label={t(template === "warning" ? "hr.docgen.warningDetails" : "hr.docgen.details")} htmlFor="docgen-details" error={fieldErrors.details} hint={t(template === "warning" ? "hr.docgen.warningHint" : "hr.docgen.detailsHint")}>
          <Textarea id="docgen-details" name="details" rows={4} maxLength={3000} required={template === "warning"} />
        </Field>
      ) : null}
      <FormError error={error} />
      {created ? (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm">
          <CheckCircle2 aria-hidden className="size-4 text-success" />
          <span className="min-w-0 flex-1">{t("hr.docgen.created", { name: created.name })}</span>
          <a href={`${viewBase}/${created.id}?view=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {t("hr.docgen.open")}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy}>
          <FileSignature aria-hidden />
          {busy ? t("hr.docgen.generating") : t("hr.docgen.generate")}
        </Button>
      </div>
    </form>
  );
}
