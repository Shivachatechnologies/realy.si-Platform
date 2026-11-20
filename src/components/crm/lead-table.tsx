"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { LeadStageSelect, OwnerSelect, STAGES, useAction, type Owner } from "./lead-forms";
import { SCORE_TONE } from "./score";

/** A lead row, pre-formatted on the server. */
export interface LeadRow {
  id: string;
  name: string;
  account: string | null;
  ownerName: string | null;
  stage: string;
  score: number;
  scoreLabel: keyof typeof SCORE_TONE;
  value: string | null;
  weighted: string | null;
  probability: number;
  closeDate: string | null;
  nextFollowUp: string | null;
}

export function LeadTable({ base, locale, rows, owners, canManage }: { base: string; locale: string; rows: LeadRow[]; owners: Owner[]; canManage: boolean }) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<string>("CONTACTED");
  const [ownerId, setOwnerId] = useState("");
  const { busy, error, run } = useAction();
  const ids = [...selected].filter((id) => rows.some((r) => r.id === id));
  const allSelected = rows.length > 0 && ids.length === rows.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const bulk = (body: Record<string, unknown>) => run(() => api(`${base}/leads/bulk`, { body: { ...body, ids } }), () => setSelected(new Set()));

  return (
    <div className="grid">
      {canManage && ids.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-3 text-sm" role="region" aria-label={t("crm.bulkActions")}>
          <span className="font-medium">{t("crm.selected", { count: ids.length })}</span>
          <span className="flex items-center gap-1">
            <Select aria-label={t("crm.stage")} className="h-8 w-auto text-xs" value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {t(`crm.stages.${s}`)}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void bulk({ action: "stage", stage })}>
              {t("crm.setStage")}
            </Button>
          </span>
          <span className="flex items-center gap-1">
            <OwnerSelect className="h-8 w-auto text-xs" owners={owners} value={ownerId} onChange={setOwnerId} />
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void bulk({ action: "assign", ownerId: ownerId || null })}>
              {t("crm.assign")}
            </Button>
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("crm.archiveConfirm", { count: ids.length }))) void bulk({ action: "archive" });
            }}
          >
            <Archive aria-hidden />
            {t("crm.archive")}
          </Button>
          <div className="basis-full">
            <FormError error={error} />
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b text-start">
              {canManage ? (
                <th className="w-8 p-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label={t("crm.selectAll")}
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              ) : null}
              <th className="p-2 text-start font-medium">{t("crm.name")}</th>
              <th className="p-2 text-start font-medium">{t("crm.temperature")}</th>
              <th className="p-2 text-start font-medium">{t("crm.owner")}</th>
              <th className="p-2 text-start font-medium">{t("crm.stage")}</th>
              <th className="p-2 text-end font-medium">{t("crm.value")}</th>
              <th className="p-2 text-end font-medium">{t("crm.weighted")}</th>
              <th className="p-2 text-start font-medium">{t("crm.expectedClose")}</th>
              <th className="p-2 text-start font-medium">{t("crm.nextFollowUp")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-muted/40" : undefined}>
                {canManage ? (
                  <td className="p-2">
                    <input type="checkbox" className="size-4 accent-primary" aria-label={r.name} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                ) : null}
                <td className="p-2">
                  <Link href={`/${locale}/crm/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  {r.account ? <div className="text-xs text-muted-foreground">{r.account}</div> : null}
                </td>
                <td className="p-2">
                  <Badge tone={SCORE_TONE[r.scoreLabel]} title={t("crm.scoreHint")}>
                    {t(`crm.scoreLabels.${r.scoreLabel}`)} · {r.score}
                  </Badge>
                </td>
                <td className="p-2">{r.ownerName ?? <span className="text-muted-foreground">{t("crm.unassigned")}</span>}</td>
                <td className="p-2">{canManage ? <LeadStageSelect base={base} leadId={r.id} stage={r.stage} /> : t(`crm.stages.${r.stage}`)}</td>
                <td className="p-2 text-end tabular-nums">{r.value ?? "—"}</td>
                <td className="p-2 text-end tabular-nums" title={t("crm.probabilityValue", { value: r.probability })}>
                  {r.weighted ?? "—"}
                </td>
                <td className="p-2">{r.closeDate ?? "—"}</td>
                <td className="p-2 text-xs text-muted-foreground">{r.nextFollowUp ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
