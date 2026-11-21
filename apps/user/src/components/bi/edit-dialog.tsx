"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { ReportForm, type ReportValues } from "./report-form";
import { DashboardForm } from "./dashboard-form";

export function EditReportDialog(props: { apiBase: string; metrics: { key: string; label: string; group: string }[]; reportId: string; initial: ReportValues; label: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {props.label}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("analytics.reports.edit")} closeLabel={t("common.close")} className="max-w-3xl">
        <ReportForm apiBase={props.apiBase} metrics={props.metrics} reportId={props.reportId} initial={props.initial} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function EditDashboardDialog(props: { apiBase: string; dashboardId: string; initial: { name: string; description: string; shared: boolean }; label: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {props.label}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("analytics.dashboards.edit")} closeLabel={t("common.close")}>
        <DashboardForm apiBase={props.apiBase} dashboardId={props.dashboardId} initial={props.initial} />
      </DialogContent>
    </Dialog>
  );
}
