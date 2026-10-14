"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";

/** Every administrative change carries a reason that lands in the audit log. */
export function ReasonDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description} closeLabel={t("common.close")}>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await onConfirm(reason);
              setOpen(false);
              setReason("");
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={t("common.reason")} htmlFor="reason" hint={t("common.reasonHint")}>
            <Textarea id="reason" required minLength={3} placeholder={t("common.reasonPlaceholder")} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={busy || reason.trim().length < 3}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
