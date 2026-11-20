"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Go to a journey stage; the stage is saved server-side first so the founder resumes there. */
export function StageGo({ to, children, variant = "luminous", back = false, query }: { to: string; children: ReactNode; variant?: "luminous" | "secondary" | "ghost"; back?: boolean; query?: string }) {
  const { locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="grid gap-1">
      <Button
        size={back ? "default" : "xl"}
        variant={variant}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api("/api/v1/me/onboarding", { method: "PATCH", body: { journeyStage: to } });
            router.push(`/${locale}/onboarding?stage=${to}${query ? `&${query}` : ""}`);
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        {back ? <ArrowLeft aria-hidden className="rtl:rotate-180" /> : null}
        {children}
        {back ? null : <ArrowRight aria-hidden className="rtl:rotate-180" />}
      </Button>
      <FormError error={error} />
    </div>
  );
}
