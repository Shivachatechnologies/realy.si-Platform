"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./use-action";

const DAYS = [null, 30, 90, 180, 365, 730, 1825] as const;

export function RetentionForm({
  orgId,
  initial,
}: {
  orgId: string;
  initial: {
    auditRetentionDays: number | null;
    dataRetentionDays: number | null;
  };
}) {
  const { t } = useI18n();
  const [audit, setAudit] = useState(initial.auditRetentionDays === null ? "" : String(initial.auditRetentionDays));
  const [data, setData] = useState(initial.dataRetentionDays === null ? "" : String(initial.dataRetentionDays));
  const a = useAction();
  const opts = (current: number | null) => {
    const list: (number | null)[] = [...DAYS];
    if (current && !list.includes(current)) list.push(current);
    return list.map((d) => (
      <option key={d ?? "keep"} value={d ?? ""}>
        {d === null ? t("enterprise.data.keepForever") : t("enterprise.developers.days", { count: d })}
      </option>
    ));
  };
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(() =>
          api(`/api/v1/organizations/${orgId}/enterprise/retention`, {
            method: "PUT",
            body: {
              auditRetentionDays: audit ? Number(audit) : null,
              dataRetentionDays: data ? Number(data) : null,
            },
          }),
        );
      }}
    >
      <Field label={t("enterprise.data.auditRetention")} htmlFor="ret-audit" hint={t("enterprise.data.auditRetentionHint")}>
        <Select id="ret-audit" value={audit} onChange={(e) => setAudit(e.target.value)}>
          {opts(initial.auditRetentionDays)}
        </Select>
      </Field>
      <Field label={t("enterprise.data.dataRetention")} htmlFor="ret-data" hint={t("enterprise.data.dataRetentionHint")}>
        <Select id="ret-data" value={data} onChange={(e) => setData(e.target.value)}>
          {opts(initial.dataRetentionDays)}
        </Select>
      </Field>
      <div className="grid gap-2 sm:col-span-2">
        <FormError error={a.error} />
        {a.done ? <Notice tone="success">{t("enterprise.saved")}</Notice> : null}
        <div>
          <Button type="submit" disabled={a.busy}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function RequestDeletion({ base }: { base: string }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const a = useAction();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(
          () =>
            api(`${base}/enterprise/deletion`, {
              body: { reason: reason || undefined },
            }),
          () => setReason(""),
        );
      }}
    >
      <Field label={t("common.reason")} htmlFor="del-reason" hint={t("common.reasonHint")}>
        <Textarea id="del-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <FormError error={a.error} />
      <div>
        <Button type="submit" variant="danger" disabled={a.busy}>
          {t("enterprise.data.requestDeletion")}
        </Button>
      </div>
    </form>
  );
}

export function DeletionActions({
  base,
  requestId,
  companyName,
  status,
  canConfirm,
}: {
  base: string;
  requestId: string;
  companyName: string;
  status: string;
  canConfirm: boolean;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const a = useAction();
  const url = `${base}/enterprise/deletion/${requestId}`;
  return (
    <div className="grid gap-2">
      {status === "PENDING" && canConfirm ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(() => api(url, { body: { action: "confirm", confirmName: name } }));
          }}
        >
          <Field label={t("enterprise.data.typeName", { name: companyName })} htmlFor={`confirm-${requestId}`} className="min-w-60 flex-1">
            <Input id={`confirm-${requestId}`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="danger" disabled={a.busy || name.trim() !== companyName}>
            {t("enterprise.data.confirmDeletion")}
          </Button>
        </form>
      ) : null}
      <div>
        <Button size="sm" variant="secondary" disabled={a.busy} onClick={() => void a.run(() => api(url, { body: { action: "cancel" } }))}>
          {t("enterprise.data.cancelDeletion")}
        </Button>
      </div>
      <FormError error={a.error} />
    </div>
  );
}
