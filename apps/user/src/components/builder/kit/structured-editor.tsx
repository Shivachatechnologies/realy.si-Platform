"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useT } from "@/i18n/client";

/**
 * A plain-language form for any Founder Kit structured part: text fields, numbers, lists (one item per line), choices and
 * repeated groups (add / remove), so a founder edits personas, pricing tiers, milestones or forecast months without JSON.
 * The server validates the result against the deliverable's schema.
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Enums = Record<string, readonly string[]>;

const HIDDEN = new Set(["sources", "research", "assetIds", "provider", "model", "prompt"]);
const LONG = new Set(["summary", "icp", "statement", "description", "content", "purpose", "rationale", "mission", "vision", "objective", "audience", "keyBenefit", "targetCustomer"]);

function useLabel() {
  const t = useT();
  return (k: string) => {
    const key = `builder.kit.fields.${k}`;
    const v = t(key);
    return v === key ? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) : v;
  };
}

/** A blank item shaped like the first existing one (strings empty, numbers 0, lists empty). */
function blankLike(sample: Json | undefined): Json {
  if (sample === undefined || sample === null) return "";
  if (typeof sample === "string") return "";
  if (typeof sample === "number") return 0;
  if (typeof sample === "boolean") return false;
  if (Array.isArray(sample)) return [];
  return Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, blankLike(v)]));
}

function Field({ name, value, onChange, enums, depth }: { name: string; value: Json; onChange: (v: Json) => void; enums: Enums; depth: number }) {
  const label = useLabel();
  const t = useT();
  const id = useId();
  const options = enums[name];

  if (Array.isArray(value)) {
    const objects = value.length > 0 && typeof value[0] === "object" && value[0] !== null && !Array.isArray(value[0]);
    if (!objects && options) {
      const set = new Set(value as string[]);
      return (
        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">{label(name)}</legend>
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
              <label key={o} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs has-[:checked]:border-primary has-[:checked]:bg-accent/60">
                <input type="checkbox" className="accent-[var(--primary)]" checked={set.has(o)} onChange={(e) => onChange(e.target.checked ? [...set, o] : [...set].filter((x) => x !== o))} />
                {o.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    if (!objects) {
      return (
        <div className="grid gap-1">
          <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
            {label(name)} <span className="font-normal">· {t("builder.kit.edit.onePerLine")}</span>
          </label>
          <Textarea id={id} rows={Math.min(8, Math.max(2, value.length + 1))} value={(value as Json[]).map(String).join("\n")} onChange={(e) => onChange(e.target.value.split("\n").map((l) => l.trimStart()).filter((l, i, a) => l.trim() || i === a.length - 1))} />
        </div>
      );
    }
    return (
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{label(name)}</legend>
        {(value as Json[]).map((v, i) => (
          <div key={i} className="grid gap-2 rounded-lg border bg-surface-2/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium tabular-nums text-muted-foreground">#{i + 1}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange((value as Json[]).filter((_, j) => j !== i))} aria-label={t("builder.kit.edit.remove")}>
                <Trash2 aria-hidden />
              </Button>
            </div>
            <ObjectFields value={v as { [k: string]: Json }} onChange={(nv) => onChange((value as Json[]).map((x, j) => (j === i ? nv : x)))} enums={enums} depth={depth + 1} />
          </div>
        ))}
        <div>
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...(value as Json[]), blankLike((value as Json[])[0])])}>
            <Plus aria-hidden />
            {t("builder.kit.edit.add")}
          </Button>
        </div>
      </fieldset>
    );
  }
  if (value !== null && typeof value === "object") {
    return (
      <fieldset className="grid gap-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">{label(name)}</legend>
        <ObjectFields value={value} onChange={onChange} enums={enums} depth={depth + 1} />
      </fieldset>
    );
  }
  if (options) {
    return (
      <div className="grid gap-1">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label(name)}</label>
        <Select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <div className="grid gap-1">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label(name)}</label>
        <Input id={id} type="number" inputMode="decimal" step="any" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
      </div>
    );
  }
  const text = value === null ? "" : String(value);
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label(name)}</label>
      {LONG.has(name) || text.length > 90 ? <Textarea id={id} rows={Math.min(8, Math.max(2, Math.ceil(text.length / 80)))} value={text} onChange={(e) => onChange(e.target.value)} /> : <Input id={id} value={text} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function ObjectFields({ value, onChange, enums, depth }: { value: { [k: string]: Json }; onChange: (v: Json) => void; enums: Enums; depth: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 [&>*:has(textarea)]:sm:col-span-2 [&>fieldset]:sm:col-span-2">
      {Object.entries(value)
        .filter(([k]) => !HIDDEN.has(k))
        .map(([k, v]) => (
          <Field key={k} name={k} value={v} enums={enums} depth={depth} onChange={(nv) => onChange({ ...value, [k]: nv })} />
        ))}
    </div>
  );
}

export function StructuredEditor({ value, onChange, enums }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; enums: Enums }) {
  return <ObjectFields value={value as { [k: string]: Json }} onChange={(v) => onChange(v as Record<string, unknown>)} enums={enums} depth={0} />;
}

/** Remove empty lines left in string lists while typing (the server rejects empty strings). */
export function cleanData(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => !(typeof x === "string" && !x.trim())).map(cleanData);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanData(x)]));
  return typeof v === "string" ? v.trim() : v;
}
