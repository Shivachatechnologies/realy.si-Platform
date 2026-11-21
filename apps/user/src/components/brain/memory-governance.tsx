"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

type Target = "customer" | "employee";

/** Data deletion (per customer / per AI employee) and JSON export of the shared memory. Managers only. */
export function MemoryGovernance({
  organizationId,
  companyId,
  accounts,
  employees,
}: {
  organizationId: string;
  companyId: string;
  /** Customers the viewer may see (empty when they lack sales.read). */
  accounts: { id: string; name: string }[];
  employees: { id: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}/brain/memory`;
  const [target, setTarget] = useState<Target>(accounts.length ? "customer" : "employee");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ memories: number; documents: number; employeeNotes: number; links: number } | null>(null);
  const options = target === "customer" ? accounts : employees;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    const name = options.find((o) => o.id === id)?.name ?? "";
    if (!window.confirm(t("brain.memory.forget.confirm", { name }))) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const body = target === "customer" ? { kind: "customer", subjectType: "account", subjectId: id } : { kind: "employee", aiEmployeeId: id };
      setDone(await api<{ memories: number; documents: number; employeeNotes: number; links: number }>(`${base}/forget`, { body }));
      setId("");
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
        <Field label={t("brain.memory.forget.what")} htmlFor="forget-kind">
          <Select
            id="forget-kind"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as Target);
              setId("");
            }}
          >
            {accounts.length ? <option value="customer">{t("brain.memory.forget.customer")}</option> : null}
            <option value="employee">{t("brain.memory.forget.employee")}</option>
          </Select>
        </Field>
        <Field label={target === "customer" ? t("brain.memory.forget.customer") : t("brain.memory.forget.employee")} htmlFor="forget-id">
          <Select id="forget-id" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">{t("brain.memory.forget.choose")}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="danger" disabled={busy || !id}>
          <Eraser aria-hidden />
          {t("brain.memory.forget.submit")}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{target === "customer" ? t("brain.memory.forget.customerHint") : t("brain.memory.forget.employeeHint")}</p>
      {done ? <Notice tone="success">{t("brain.memory.forget.done", { memories: done.memories, documents: done.documents, notes: done.employeeNotes })}</Notice> : null}
      <FormError error={error} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-sm text-muted-foreground">{t("brain.memory.exportHint")}</p>
        <Button asChild variant="secondary" size="sm">
          <a href={`${base}/export`} download>
            <Download aria-hidden />
            {t("brain.memory.export")}
          </a>
        </Button>
      </div>
    </div>
  );
}
