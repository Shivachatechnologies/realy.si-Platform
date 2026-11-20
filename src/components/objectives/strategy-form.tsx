"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useSubmit } from "./objective-forms";

interface Pillar {
  id?: string;
  title: string;
  description: string;
}

/** Edit mission, vision, values and strategic pillars (saved together). */
export function StrategyForm({ base, initial }: { base: string; initial: { mission: string; vision: string; values: string[]; pillars: Pillar[] } }) {
  const t = useT();
  const [mission, setMission] = useState(initial.mission);
  const [vision, setVision] = useState(initial.vision);
  const [values, setValues] = useState<string[]>(initial.values);
  const [value, setValue] = useState("");
  const [pillars, setPillars] = useState<Pillar[]>(initial.pillars);
  const [saved, setSaved] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    setSaved(false);
    await api(`${base}/strategy`, { method: "PUT", body: { mission, vision, values, pillars: pillars.filter((p) => p.title.trim()) } });
    setSaved(true);
  });
  const setPillar = (i: number, p: Partial<Pillar>) => setPillars(pillars.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...pillars];
    const [p] = next.splice(i, 1);
    next.splice(i + d, 0, p!);
    setPillars(next);
  };
  const addValue = () => {
    const v = value.trim();
    if (v && !values.includes(v) && values.length < 20) setValues([...values, v]);
    setValue("");
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label={t("strategy.mission")} htmlFor="strategy-mission" hint={t("strategy.missionHint")}>
          <Textarea id="strategy-mission" rows={3} maxLength={2000} value={mission} onChange={(e) => setMission(e.target.value)} />
        </Field>
        <Field label={t("strategy.vision")} htmlFor="strategy-vision" hint={t("strategy.visionHint")}>
          <Textarea id="strategy-vision" rows={3} maxLength={2000} value={vision} onChange={(e) => setVision(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{t("strategy.values")}</span>
        {values.length ? (
          <ul className="flex flex-wrap gap-2">
            {values.map((v) => (
              <li key={v} className="flex items-center gap-1 rounded-md border bg-surface-2 px-2 py-1 text-sm">
                {v}
                <button type="button" className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted" aria-label={t("strategy.removeValue", { value: v })} onClick={() => setValues(values.filter((x) => x !== v))}>
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <Input
            aria-label={t("strategy.addValue")}
            placeholder={t("strategy.valuePlaceholder")}
            value={value}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addValue();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={addValue} disabled={!value.trim()}>
            <Plus aria-hidden />
            {t("strategy.addValue")}
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{t("strategy.pillars")}</span>
        {pillars.length === 0 ? <p className="text-sm text-muted-foreground">{t("strategy.noPillars")}</p> : null}
        {pillars.map((p, i) => (
          <div key={p.id ?? `new-${i}`} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]">
            <Input aria-label={t("strategy.pillarTitle")} placeholder={t("strategy.pillarTitle")} value={p.title} maxLength={200} onChange={(e) => setPillar(i, { title: e.target.value })} />
            <Input aria-label={t("strategy.pillarDescription")} placeholder={t("strategy.pillarDescription")} value={p.description} maxLength={1000} onChange={(e) => setPillar(i, { description: e.target.value })} />
            <span className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("strategy.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("strategy.moveDown")} disabled={i === pillars.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("strategy.removePillar")} onClick={() => setPillars(pillars.filter((_, j) => j !== i))}>
                <X aria-hidden />
              </Button>
            </span>
          </div>
        ))}
        {pillars.length < 12 ? (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setPillars([...pillars, { title: "", description: "" }])}>
              <Plus aria-hidden />
              {t("strategy.addPillar")}
            </Button>
          </div>
        ) : null}
      </div>
      <FormError error={error} />
      {saved && !error ? <Notice tone="success">{t("strategy.saved")}</Notice> : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
