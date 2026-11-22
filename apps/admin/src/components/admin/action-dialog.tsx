"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/**
 * Confirmation dialog for administrative actions: a required reason (audited) and, for critical actions, a typed
 * confirmation phrase. `children` renders extra inputs above the reason (their values travel via `onConfirm`).
 */
export function ActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  phrase,
  danger,
  children,
  onConfirm,
  canSubmit = true,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Typed confirmation: the admin must type exactly this. */
  phrase?: string;
  danger?: boolean;
  children?: ReactNode;
  canSubmit?: boolean;
  onConfirm: (reason: string, confirm: string | undefined) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ok = canSubmit && reason.trim().length >= 3 && (!phrase || typed.trim() === phrase);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
        if (!o) setTyped("");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description} closeLabel={t("common.close")}>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ok) return;
            setBusy(true);
            setError(null);
            try {
              await onConfirm(reason.trim(), phrase ? typed.trim() : undefined);
              setOpen(false);
              setReason("");
              setTyped("");
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {children}
          <Field label={t("common.reason")} htmlFor="admin-reason" hint={t("admin.common.reasonAudited")}>
            <Textarea id="admin-reason" required minLength={3} maxLength={500} placeholder={t("common.reasonPlaceholder")} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {phrase ? (
            <>
              {danger ? <Notice tone="danger">{t("admin.common.criticalWarning")}</Notice> : null}
              <Field label={t("admin.common.typeToConfirm", { phrase })} htmlFor="admin-confirm">
                <Input id="admin-confirm" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} className="font-mono" />
              </Field>
            </>
          ) : null}
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button type="submit" variant={danger ? "danger" : "default"} disabled={busy || !ok}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface AdminActionOptions {
  /** Toast shown after the call succeeds (omit for none; the refreshed page usually shows the outcome). */
  success?: string;
  /** Also toast the error (default false: errors stay inline in the dialog that rethrows them). */
  toastError?: boolean;
}

/** Call the admin API, then refresh the server-rendered page. Optional toasts via the console ToastProvider. */
export function useAdminAction(defaults: AdminActionOptions = {}) {
  const router = useRouter();
  const toast = useToast();
  return async (path: string, method: string, body: unknown, options: AdminActionOptions = {}) => {
    const o = { ...defaults, ...options };
    try {
      await api(path, { method, body });
    } catch (err) {
      if (o.toastError) toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
    if (o.success) toast.success(o.success);
    router.refresh();
  };
}

/** A simple reason-confirmed action button (e.g. revoke sessions, cancel task). */
export function ActionButton({
  label,
  title,
  description,
  path,
  method,
  body = {},
  phrase,
  danger,
  variant = "secondary",
  size = "sm",
}: {
  label: string;
  title: string;
  description?: string;
  path: string;
  method: string;
  body?: Record<string, unknown>;
  phrase?: string;
  danger?: boolean;
  variant?: "default" | "secondary" | "ghost" | "danger";
  size?: "sm" | "default";
}) {
  const run = useAdminAction();
  return (
    <ActionDialog
      trigger={
        <Button size={size} variant={variant}>
          {label}
        </Button>
      }
      title={title}
      description={description}
      confirmLabel={label}
      phrase={phrase}
      danger={danger}
      onConfirm={(reason, confirm) => run(path, method, { ...body, reason, ...(confirm !== undefined ? { confirm } : {}) })}
    />
  );
}
