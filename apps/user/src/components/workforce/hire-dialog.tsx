"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { EmployeeForm, type EmployeeFormValues } from "./employee-form";

export function HireDialog(props: {
  apiBase: string;
  profileKey: string;
  roleName: string;
  defaultName: string;
  tools: { name: string; label: string; needsApproval: boolean }[];
  members: { id: string; name: string }[];
  defaultOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const initial: EmployeeFormValues = { name: props.defaultName, initials: "", instructions: "", skills: [], allowedTools: [], runsAsUserId: null, autonomy: "EXECUTE_WITH_APPROVAL", monthlyTokenBudget: null };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <UserPlus aria-hidden />
          {t("workforce.hire.action")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("workforce.hire.dialogTitle", { role: props.roleName })} description={t("workforce.hire.dialogDescription")} closeLabel={t("common.close")} className="max-w-2xl">
        <EmployeeForm apiBase={props.apiBase} profileKey={props.profileKey} tools={props.tools} members={props.members} initial={initial} />
      </DialogContent>
    </Dialog>
  );
}

export function EditEmployeeDialog(props: {
  apiBase: string;
  profileKey: string;
  employeeId: string;
  tools: { name: string; label: string; needsApproval: boolean }[];
  members: { id: string; name: string }[];
  initial: EmployeeFormValues;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {t("workforce.employee.edit")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("workforce.employee.edit")} closeLabel={t("common.close")} className="max-w-2xl">
        <EmployeeForm {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
