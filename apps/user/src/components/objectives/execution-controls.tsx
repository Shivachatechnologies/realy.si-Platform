"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Owner AI employee picker for an objective (objectives.manage). */
export function OwnerSelect({ base, objectiveId, value, employees }: { base: string; objectiveId: string; value: string | null; employees: { id: string; name: string; role: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="inline-grid gap-1">
      <Select
        aria-label={t("objectives.execution.owner")}
        className="h-9 w-auto min-w-48 text-sm"
        value={value ?? ""}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          try {
            await api(`${base}/objectives/${objectiveId}/execution`, { method: "PUT", body: { aiEmployeeId: e.target.value || null } });
            router.refresh();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="">{t("objectives.execution.noOwner")}</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} · {e.role}
          </option>
        ))}
      </Select>
      {error ? <FormError error={error} /> : null}
    </span>
  );
}

/** Add an initiative (optionally tied to one key result). */
export function AddInitiativeForm({ base, objectiveId, keyResults }: { base: string; objectiveId: string; keyResults: { id: string; title: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kr, setKr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("objectives.execution.addInitiative")}
      </Button>
    );
  }
  return (
    <form
      className="grid w-full gap-2 rounded-xl border bg-surface p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`${base}/objectives/${objectiveId}/initiatives`, { body: { title, description: description || undefined, keyResultId: kr || null } });
          setTitle("");
          setDescription("");
          setKr("");
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="grid gap-1 text-xs font-medium">
        {t("objectives.execution.initiativeTitle")}
        <Input required minLength={2} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="grid gap-1 text-xs font-medium">
        {t("objectives.execution.initiativeDescription")}
        <Textarea rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {keyResults.length ? (
        <label className="grid gap-1 text-xs font-medium">
          {t("objectives.execution.initiativeKr")}
          <Select value={kr} onChange={(e) => setKr(e.target.value)}>
            <option value="">{t("objectives.execution.anyKr")}</option>
            {keyResults.map((k) => (
              <option key={k.id} value={k.id}>
                {k.title}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={busy}>
          {t("objectives.execution.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("objectives.execution.cancel")}
        </Button>
      </div>
      {error ? <FormError error={error} /> : null}
    </form>
  );
}

/** Initiative status picker. */
export function InitiativeStatusSelect({ base, objectiveId, initiativeId, status }: { base: string; objectiveId: string; initiativeId: string; status: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Select
      aria-label={t("objectives.execution.status")}
      className="h-8 w-auto text-xs"
      value={status}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        try {
          await api(`${base}/objectives/${objectiveId}/initiatives/${initiativeId}`, { method: "PATCH", body: { status: e.target.value } });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {["PLANNED", "ACTIVE", "DONE", "DROPPED"].map((s) => (
        <option key={s} value={s}>
          {t(`objectives.execution.initiativeStatus.${s}`)}
        </option>
      ))}
    </Select>
  );
}
