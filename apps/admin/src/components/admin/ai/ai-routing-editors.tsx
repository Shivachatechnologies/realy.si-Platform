"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "../action-dialog";

export function FallbackChainEditor({ chain, models }: { chain: string[]; models: string[] }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [list, setList] = useState(chain);
  const [pick, setPick] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Pencil />
          {t("admin.aiModels.editFallback")}
        </Button>
      }
      title={t("admin.aiModels.fallbackChain")}
      description={t("admin.aiModels.fallbackHint")}
      confirmLabel={t("common.save")}
      onConfirm={(reason) => run("/api/v1/admin/ai/routing", "PUT", { action: "fallback", chain: list, reason })}
    >
      <ol className="grid gap-1">
        {list.map((m, i) => (
          <li key={m} className="flex items-center gap-2 rounded-md border px-2 py-1 font-mono text-xs">
            <span className="text-muted-foreground">{i + 1}.</span>
            {m}
            <Button type="button" size="icon" variant="ghost" className="ms-auto size-6" aria-label={t("admin.aiModels.remove")} onClick={() => setList(list.filter((x) => x !== m))}>
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Select aria-label={t("admin.aiModels.model")} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">—</option>
          {models.filter((m) => !list.includes(m)).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Button type="button" variant="secondary" disabled={!pick || list.length >= 5} onClick={() => (setList([...list, pick]), setPick(""))}>
          <Plus />
        </Button>
      </div>
    </ActionDialog>
  );
}

export function CreditEditor({ model, current }: { model: string; current: { input: number; output: number } | null }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [inp, setInp] = useState(current ? String(current.input) : "");
  const [out, setOut] = useState(current ? String(current.output) : "");
  const clear = inp.trim() === "" && out.trim() === "";
  const ok = clear || (Number(inp) >= 0 && Number(out) >= 0 && inp.trim() !== "" && out.trim() !== "");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost" className="font-mono text-xs">
          {current ? `${current.input} / ${current.output}` : t("admin.aiModels.setCredits")}
        </Button>
      }
      title={t("admin.aiModels.creditsTitle", { model })}
      description={t("admin.aiModels.creditsHint")}
      confirmLabel={t("common.save")}
      canSubmit={ok}
      onConfirm={(reason) => run("/api/v1/admin/ai/routing", "PUT", { action: "credits", model, input: clear ? null : Number(inp), output: clear ? null : Number(out), reason })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.aiModels.creditsInput")} htmlFor={`ci-${model}`}>
          <Input id={`ci-${model}`} inputMode="decimal" value={inp} onChange={(e) => setInp(e.target.value)} />
        </Field>
        <Field label={t("admin.aiModels.creditsOutput")} htmlFor={`co-${model}`}>
          <Input id={`co-${model}`} inputMode="decimal" value={out} onChange={(e) => setOut(e.target.value)} />
        </Field>
      </div>
    </ActionDialog>
  );
}
