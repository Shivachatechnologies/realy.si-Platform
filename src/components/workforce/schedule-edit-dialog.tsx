"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { ScheduleForm, type ScheduleValues } from "./schedule-form";

export function ScheduleEditDialog(props: {
  apiBase: string;
  employees: { id: string; name: string; profileKey: string }[];
  eventTypes: readonly string[];
  scheduleId: string;
  initial: Partial<ScheduleValues>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          {t("plans.edit")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("plans.editTitle")} closeLabel={t("common.close")} className="max-w-2xl">
        <ScheduleForm {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
