"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import type { CountryOption } from "@/server/modules/globalization/options";
import { CompanyForm } from "./company-form";

export function NewCompanyDialog(props: { countries: CountryOption[]; currencies: string[]; organizationId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          {t("company.create")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("company.create")} description={t("onboarding.subtitle")} closeLabel={t("common.close")} className="max-w-2xl">
        <CompanyForm {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
