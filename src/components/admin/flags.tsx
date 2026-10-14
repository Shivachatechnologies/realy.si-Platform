"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ReasonDialog } from "./reason-dialog";

interface Rule {
  id: string;
  targetType: string;
  targetValue: string;
  enabled: boolean;
  priority: number;
}

const TARGETS = ["GLOBAL", "REGION", "COUNTRY", "PLAN", "ORGANIZATION", "COMPANY", "USER"] as const;

export function FlagCard({ flag, editable }: { flag: { id: string; key: string; description: string; defaultEnabled: boolean; rules: Rule[] }; editable: boolean }) {
  const t = useT();
  const router = useRouter();
  const [targetType, setTargetType] = useState<string>("PLAN");
  const [targetValue, setTargetValue] = useState("");
  const [enabled, setEnabled] = useState(true);
  const call = async (path: string, method: string, body: unknown) => {
    await api(path, { method, body });
    router.refresh();
  };
  return (
    <Card>
      <CardHeader
        title={<span className="font-mono">{flag.key}</span>}
        description={flag.description}
        actions={
          <>
            <Badge tone={flag.defaultEnabled ? "success" : "neutral"}>
              {t("admin.flags.default")}: {flag.defaultEnabled ? t("common.enabled") : t("common.disabled")}
            </Badge>
            {editable ? (
              <ReasonDialog
                trigger={<Button size="sm" variant="secondary">{flag.defaultEnabled ? t("admin.flags.turnOff") : t("admin.flags.turnOn")}</Button>}
                title={flag.key}
                confirmLabel={flag.defaultEnabled ? t("admin.flags.turnOff") : t("admin.flags.turnOn")}
                onConfirm={(reason) => call(`/api/v1/admin/feature-flags/${flag.id}`, "PATCH", { defaultEnabled: !flag.defaultEnabled, reason })}
              />
            ) : null}
          </>
        }
      />
      <CardBody className="grid gap-3">
        {flag.rules.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("admin.flags.noRules")}</p>
        ) : (
          <ul className="grid gap-1">
            {flag.rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <Badge>{r.targetType}</Badge>
                <span className="font-mono">{r.targetValue}</span>
                <Badge tone={r.enabled ? "success" : "danger"}>{r.enabled ? t("common.enabled") : t("common.disabled")}</Badge>
                {editable ? (
                  <span className="ms-auto">
                    <ReasonDialog
                      trigger={<Button size="sm" variant="ghost">{t("admin.flags.remove")}</Button>}
                      title={`${flag.key} · ${r.targetType}:${r.targetValue}`}
                      confirmLabel={t("admin.flags.remove")}
                      onConfirm={(reason) => call(`/api/v1/admin/feature-flag-rules/${r.id}`, "DELETE", { reason })}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editable ? (
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <Field label={t("admin.flags.target")} htmlFor={`tt-${flag.id}`}>
              <Select id={`tt-${flag.id}`} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
                {TARGETS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            </Field>
            {targetType !== "GLOBAL" ? (
              <Field label={t("admin.flags.value")} htmlFor={`tv-${flag.id}`}>
                <Input id={`tv-${flag.id}`} dir="ltr" className="font-mono" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
              </Field>
            ) : null}
            <Field label={t("common.status")} htmlFor={`te-${flag.id}`}>
              <Select id={`te-${flag.id}`} value={enabled ? "1" : "0"} onChange={(e) => setEnabled(e.target.value === "1")}>
                <option value="1">{t("common.enabled")}</option>
                <option value="0">{t("common.disabled")}</option>
              </Select>
            </Field>
            <ReasonDialog
              trigger={
                <Button size="sm" disabled={targetType !== "GLOBAL" && !targetValue}>
                  {t("admin.flags.addRule")}
                </Button>
              }
              title={`${t("admin.flags.addRule")} · ${flag.key}`}
              confirmLabel={t("admin.flags.addRule")}
              onConfirm={(reason) => call(`/api/v1/admin/feature-flags/${flag.id}/rules`, "POST", { targetType, targetValue: targetValue || "*", enabled, reason })}
            />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
