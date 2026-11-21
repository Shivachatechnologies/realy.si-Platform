"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { ProfileForm, type ProfileOptions, type ProfileSection, type ProfileValues } from "./profile-form";

/** "Edit profile" on the employee page: job, reporting line, goals and KPIs, model. */
export function ProfileDialog(props: { apiBase: string; employeeId: string; initial: ProfileValues; options: ProfileOptions; sections?: ProfileSection[]; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {props.label ?? t("workforce.profile.edit")}
        </Button>
      </DialogTrigger>
      <DialogContent title={props.label ?? t("workforce.profile.edit")} closeLabel={t("common.close")} className="max-w-2xl">
        <ProfileForm apiBase={props.apiBase} employeeId={props.employeeId} sections={props.sections ?? ["configure", "role", "goals"]} initial={props.initial} options={props.options} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
