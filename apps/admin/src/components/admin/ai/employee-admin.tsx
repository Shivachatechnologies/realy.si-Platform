"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "../action-dialog";

const AUTONOMY = ["READ_ONLY", "RECOMMEND", "PREPARE", "EXECUTE_WITH_APPROVAL", "AUTONOMOUS_LOW_RISK"] as const;

export function EmployeeAdmin({
  employee,
  models,
}: {
  employee: { id: string; name: string; model: string | null; autonomy: string; status: string; monthlyTokenBudget: number | null; monthlyCostBudgetCents: string | null; allowedTools: string[]; profileTools: string[] };
  models: string[];
}) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [model, setModel] = useState(employee.model ?? "");
  const [autonomy, setAutonomy] = useState(employee.autonomy);
  const [status, setStatus] = useState(employee.status);
  const [tokens, setTokens] = useState(employee.monthlyTokenBudget === null ? "" : String(employee.monthlyTokenBudget));
  const [usd, setUsd] = useState(employee.monthlyCostBudgetCents === null ? "" : String(Number(employee.monthlyCostBudgetCents) / 100));
  const [tools, setTools] = useState<string[]>(employee.allowedTools);
  const body = () => {
    const b: Record<string, unknown> = {};
    if ((model || null) !== employee.model) b.model = model || null;
    if (autonomy !== employee.autonomy) b.autonomy = autonomy;
    if (status !== employee.status) b.status = status;
    const tk = tokens.trim() === "" ? null : Math.round(Number(tokens));
    if (tk !== employee.monthlyTokenBudget) b.monthlyTokenBudget = tk;
    const c = usd.trim() === "" ? null : Math.round(Number(usd) * 100);
    if (String(c) !== String(employee.monthlyCostBudgetCents === null ? null : Number(employee.monthlyCostBudgetCents))) b.monthlyCostBudgetCents = c;
    if (tools.join() !== employee.allowedTools.join()) b.allowedTools = tools;
    return b;
  };
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost">
          <Pencil />
          {t("admin.aiWorkforce.manage")}
        </Button>
      }
      title={t("admin.aiWorkforce.manageTitle", { name: employee.name })}
      description={t("admin.aiWorkforce.manageHint")}
      confirmLabel={t("common.save")}
      canSubmit={Object.keys(body()).length > 0}
      onConfirm={(reason) => run(`/api/v1/admin/ai/employees/${employee.id}`, "PUT", { ...body(), reason })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.aiModels.model")} htmlFor={`em-model-${employee.id}`}>
          <Select id={`em-model-${employee.id}`} value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">{t("admin.aiModels.platformDefault")}</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.aiWorkforce.autonomy")} htmlFor={`em-aut-${employee.id}`}>
          <Select id={`em-aut-${employee.id}`} value={autonomy} onChange={(e) => setAutonomy(e.target.value)}>
            {AUTONOMY.map((a) => (
              <option key={a} value={a}>
                {t(`admin.aiWorkforce.autonomyLevels.${a}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.aiWorkforce.tokenBudget")} htmlFor={`em-tok-${employee.id}`} hint={t("admin.aiModels.budgetEmpty")}>
          <Input id={`em-tok-${employee.id}`} inputMode="numeric" value={tokens} onChange={(e) => setTokens(e.target.value)} />
        </Field>
        <Field label={t("admin.aiWorkforce.costBudget")} htmlFor={`em-usd-${employee.id}`} hint={t("admin.aiModels.budgetEmpty")}>
          <Input id={`em-usd-${employee.id}`} inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} />
        </Field>
        <Field label={t("admin.users.columns.status")} htmlFor={`em-st-${employee.id}`}>
          <Select id={`em-st-${employee.id}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">{t("admin.aiWorkforce.status.ACTIVE")}</option>
            <option value="PAUSED">{t("admin.aiWorkforce.status.PAUSED")}</option>
          </Select>
        </Field>
      </div>
      {employee.profileTools.length ? (
        <fieldset className="grid gap-1">
          <legend className="text-[13px] font-medium">{t("admin.aiWorkforce.tools")}</legend>
          <p className="text-[11px] text-muted-foreground">{t("admin.aiWorkforce.toolsHint")}</p>
          <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
            {employee.profileTools.map((tool) => (
              <label key={tool} className="flex items-center gap-2 font-mono text-[11px]">
                <input type="checkbox" checked={tools.includes(tool)} onChange={(e) => setTools(e.target.checked ? [...tools, tool] : tools.filter((x) => x !== tool))} />
                {tool}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </ActionDialog>
  );
}
