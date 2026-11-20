"use client";

import { useState, type FormEvent } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { splitList } from "./format";
import { useAction } from "./ui";

export interface BrandValues {
  brandName: string;
  tagline: string;
  voiceTone: string;
  messagingPillars: string;
  doWords: string;
  dontWords: string;
  personas: { name: string; description: string }[];
  colors: { name: string; hex: string }[];
  logoUrl: string;
  logoDarkUrl: string;
  iconUrl: string;
  headingFont: string;
  bodyFont: string;
}

/** Create / edit the company brand kit (PUT <base>/brand). */
export function BrandKitForm({ base, initial, exists }: { base: string; initial: BrandValues; exists: boolean }) {
  const t = useT();
  const [f, setF] = useState<BrandValues>(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof BrandValues) => (e: { target: { value: string } }) => {
    setSaved(false);
    setF((p) => ({ ...p, [k]: e.target.value }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      brandName: f.brandName,
      tagline: f.tagline || null,
      voiceTone: f.voiceTone || null,
      messagingPillars: f.messagingPillars.split("\n").map((s) => s.trim()).filter(Boolean),
      doWords: splitList(f.doWords),
      dontWords: splitList(f.dontWords),
      personas: f.personas.filter((p) => p.name.trim()),
      colors: f.colors.filter((c) => c.name.trim()),
      logoUrl: f.logoUrl || null,
      logoDarkUrl: f.logoDarkUrl || null,
      iconUrl: f.iconUrl || null,
      headingFont: f.headingFont || null,
      bodyFont: f.bodyFont || null,
    };
    void run(() => api(`${base}/brand`, { method: "PUT", body: payload }), () => setSaved(true));
  };
  return (
    <form onSubmit={submit} className="grid gap-4 p-4 sm:grid-cols-2">
      <Field label={t("marketing.brand.brandName")} htmlFor="b-name">
        <Input id="b-name" value={f.brandName} maxLength={120} required onChange={set("brandName")} />
      </Field>
      <Field label={t("marketing.brand.tagline")} htmlFor="b-tag">
        <Input id="b-tag" value={f.tagline} maxLength={200} onChange={set("tagline")} />
      </Field>
      <Field label={t("marketing.brand.voiceTone")} htmlFor="b-voice" hint={t("marketing.brand.voiceToneHint")} className="sm:col-span-2">
        <Textarea id="b-voice" rows={3} value={f.voiceTone} maxLength={3000} onChange={set("voiceTone")} />
      </Field>
      <Field label={t("marketing.brand.pillars")} htmlFor="b-pillars" hint={t("marketing.brand.pillarsHint")} className="sm:col-span-2">
        <Textarea id="b-pillars" rows={4} value={f.messagingPillars} onChange={set("messagingPillars")} />
      </Field>
      <Field label={t("marketing.brand.doWords")} htmlFor="b-do" hint={t("marketing.common.commaSeparated")}>
        <Textarea id="b-do" rows={2} value={f.doWords} onChange={set("doWords")} />
      </Field>
      <Field label={t("marketing.brand.dontWords")} htmlFor="b-dont" hint={t("marketing.common.commaSeparated")}>
        <Textarea id="b-dont" rows={2} value={f.dontWords} onChange={set("dontWords")} />
      </Field>

      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">{t("marketing.brand.personas")}</legend>
        {f.personas.map((p, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
            <Input
              aria-label={t("marketing.brand.personaName")}
              placeholder={t("marketing.brand.personaName")}
              value={p.name}
              maxLength={80}
              onChange={(e) => setF((x) => ({ ...x, personas: x.personas.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)) }))}
            />
            <Input
              aria-label={t("marketing.brand.personaDescription")}
              placeholder={t("marketing.brand.personaDescription")}
              value={p.description}
              maxLength={1000}
              onChange={(e) => setF((x) => ({ ...x, personas: x.personas.map((q, j) => (j === i ? { ...q, description: e.target.value } : q)) }))}
            />
            <Button type="button" variant="ghost" size="sm" aria-label={t("marketing.common.delete")} onClick={() => setF((x) => ({ ...x, personas: x.personas.filter((_, j) => j !== i) }))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        {f.personas.length < 10 ? (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setF((x) => ({ ...x, personas: [...x.personas, { name: "", description: "" }] }))}>
              <Plus aria-hidden />
              {t("marketing.brand.addPersona")}
            </Button>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">{t("marketing.brand.colors")}</legend>
        <p className="text-xs text-muted-foreground">{t("marketing.brand.colorsHint")}</p>
        <div className="flex flex-wrap gap-2">
          {f.colors.map((c, i) => (
            <div key={i} className="flex items-center gap-1 rounded-md border p-1">
              <input
                type="color"
                aria-label={t("marketing.brand.colorValue")}
                value={c.hex}
                className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent"
                onChange={(e) => setF((x) => ({ ...x, colors: x.colors.map((q, j) => (j === i ? { ...q, hex: e.target.value } : q)) }))}
              />
              <Input
                className="w-28"
                aria-label={t("marketing.brand.colorName")}
                placeholder={t("marketing.brand.colorName")}
                value={c.name}
                maxLength={40}
                onChange={(e) => setF((x) => ({ ...x, colors: x.colors.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)) }))}
              />
              <span className="font-mono text-xs">{c.hex}</span>
              <Button type="button" variant="ghost" size="sm" aria-label={t("marketing.common.delete")} onClick={() => setF((x) => ({ ...x, colors: x.colors.filter((_, j) => j !== i) }))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          {f.colors.length < 12 ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setF((x) => ({ ...x, colors: [...x.colors, { name: x.colors.length ? "" : t("marketing.brand.primary"), hex: "#2563eb" }] }))}>
              <Plus aria-hidden />
              {t("marketing.brand.addColor")}
            </Button>
          ) : null}
        </div>
      </fieldset>

      <Field label={t("marketing.brand.logoUrl")} htmlFor="b-logo" hint={t("marketing.brand.logoHint")}>
        <Input id="b-logo" type="url" placeholder="https://" value={f.logoUrl} maxLength={1000} onChange={set("logoUrl")} />
      </Field>
      <Field label={t("marketing.brand.logoDarkUrl")} htmlFor="b-logo-dark">
        <Input id="b-logo-dark" type="url" placeholder="https://" value={f.logoDarkUrl} maxLength={1000} onChange={set("logoDarkUrl")} />
      </Field>
      <Field label={t("marketing.brand.iconUrl")} htmlFor="b-icon">
        <Input id="b-icon" type="url" placeholder="https://" value={f.iconUrl} maxLength={1000} onChange={set("iconUrl")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("marketing.brand.headingFont")} htmlFor="b-hfont">
          <Input id="b-hfont" value={f.headingFont} maxLength={80} onChange={set("headingFont")} />
        </Field>
        <Field label={t("marketing.brand.bodyFont")} htmlFor="b-bfont">
          <Input id="b-bfont" value={f.bodyFont} maxLength={80} onChange={set("bodyFont")} />
        </Field>
      </div>

      <div className="grid gap-2 sm:col-span-2">
        <FormError error={error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !f.brandName.trim()}>
            <Save aria-hidden />
            {exists ? t("marketing.brand.save") : t("marketing.brand.create")}
          </Button>
          {saved ? <span className="text-sm text-success">{t("marketing.brand.saved")}</span> : null}
        </div>
      </div>
    </form>
  );
}
