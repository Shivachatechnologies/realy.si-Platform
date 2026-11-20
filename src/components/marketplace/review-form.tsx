"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function ReviewForm({ orgId, listingKey, existing }: { orgId: string; listingKey: string; existing: { id: string; rating: number; title: string; body: string } | null }) {
  const t = useT();
  const router = useRouter();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void act(() =>
          api(`/api/v1/organizations/${orgId}/marketplace/reviews`, {
            body: { listingKey, rating, title, body },
          }),
        );
      }}
    >
      <fieldset className="grid gap-1">
        <legend className="text-sm font-medium">{t("marketplace.reviews.yourRating")}</legend>
        <div className="flex gap-1" role="radiogroup">
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={rating === i}
              aria-label={t("marketplace.reviews.stars", { count: i })}
              onClick={() => setRating(i)}
              className={cn("text-2xl leading-none transition-colors", i <= rating ? "text-warning" : "text-muted-foreground/40 hover:text-warning/60")}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <Field label={t("marketplace.reviews.title")} htmlFor="review-title">
        <Input id="review-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("marketplace.reviews.body")} htmlFor="review-body">
        <Textarea id="review-body" rows={3} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <FormError error={error} />
      {saved ? <p className="text-xs text-success">{t("marketplace.reviews.saved")}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || rating < 1}>
          {existing ? t("marketplace.reviews.update") : t("marketplace.reviews.submit")}
        </Button>
        {existing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void act(() => api(`/api/v1/organizations/${orgId}/marketplace/reviews/${existing.id}`, { method: "DELETE" }))}
          >
            {t("marketplace.reviews.delete")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
