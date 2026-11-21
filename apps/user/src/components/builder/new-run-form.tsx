"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { BriefForm, type BriefMode } from "./brief-form";

/** Start the builder for the active company from the essential questions. */
export function NewRunForm({ base, mode, countries, currencies, defaultCurrency, defaultCountry }: { base: string; mode: BriefMode; countries: string[]; currencies: string[]; defaultCurrency: string; defaultCountry: string | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  return (
    <BriefForm
      mode={mode}
      countries={countries}
      currencies={currencies}
      defaultCurrency={defaultCurrency}
      defaultCountry={defaultCountry}
      submitLabel={mode === "NEW_IDEA" ? t("builder.new.submit") : t("builder.new.submitExisting")}
      onSubmit={async (brief) => {
        const run = await api<{ id: string }>(`${base}/builder/runs`, { body: { mode, brief, kit: mode === "NEW_IDEA" } });
        router.push(`/${locale}/builder/${run.id}${mode === "NEW_IDEA" ? "/kit" : ""}`);
        router.refresh();
      }}
    />
  );
}
