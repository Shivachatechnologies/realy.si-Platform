"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { SENSITIVITY_OPTIONS } from "./memory-form";

const LAYERS = ["DOCUMENT", "KNOWLEDGE", "PRODUCT", "BRAND", "CUSTOMER", "DEPARTMENT", "EMPLOYEE"] as const;

/** Document governance (managers): memory layer, sensitivity, extra read permission, owner customer / AI employee, expiry. */
export function DocumentPolicyForm({
  organizationId,
  companyId,
  documentId,
  policy,
  readPermissions,
  accounts,
  employees,
}: {
  organizationId: string;
  companyId: string;
  documentId: string;
  policy: { layer: string; sensitivity: string; readPermission: string | null; subjectType: string | null; subjectId: string | null; aiEmployeeId: string | null; expiresOn: string | null } | null;
  readPermissions: string[];
  accounts: { id: string; name: string }[];
  employees: { id: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [layer, setLayer] = useState(policy?.layer ?? "DOCUMENT");
  const [sensitivity, setSensitivity] = useState(policy?.sensitivity ?? "INTERNAL");
  const [readPermission, setReadPermission] = useState(policy?.readPermission ?? "");
  const [accountId, setAccountId] = useState(policy?.subjectType === "account" ? (policy.subjectId ?? "") : "");
  const [employeeId, setEmployeeId] = useState(policy?.aiEmployeeId ?? "");
  const [expiresOn, setExpiresOn] = useState(policy?.expiresOn ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/api/v1/organizations/${organizationId}/companies/${companyId}/brain/documents/${documentId}/policy`, {
        method: "PUT",
        body: {
          layer,
          sensitivity,
          readPermission: readPermission || null,
          // Keep a contact owner set elsewhere; only accounts are offered here.
          ...(policy?.subjectType === "contact" && !accountId ? {} : { subject: accountId ? { type: "account", id: accountId } : null }),
          employeeId: employeeId || null,
          expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59Z`).toISOString() : null,
        },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("brain.memory.layerLabel")} htmlFor="dp-layer">
          <Select id="dp-layer" value={layer} onChange={(e) => setLayer(e.target.value)}>
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {t(`brain.memory.layers.${l}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("brain.memory.sensitivityLabel")} htmlFor="dp-sensitivity">
          <Select id="dp-sensitivity" value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}>
            {SENSITIVITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`brain.memory.sensitivity.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("brain.memory.readPermissionLabel")} htmlFor="dp-perm">
          <Select id="dp-perm" value={readPermission} onChange={(e) => setReadPermission(e.target.value)}>
            <option value="">{t("brain.memory.noExtraPermission")}</option>
            {readPermissions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        {accounts.length ? (
          <Field label={t("brain.memory.forget.customer")} htmlFor="dp-account">
            <Select id="dp-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t("brain.memory.forget.employee")} htmlFor="dp-employee">
          <Select id="dp-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">—</option>
            {employees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("brain.memory.expiresLabel")} htmlFor="dp-expires" hint={t("brain.memory.documentExpiresHint")}>
          <Input id="dp-expires" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </Field>
      </div>
      <FormError error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          <Save aria-hidden />
          {t("brain.save")}
        </Button>
        {saved ? <span className="text-sm text-success">{t("brain.saved")}</span> : null}
      </div>
    </form>
  );
}
