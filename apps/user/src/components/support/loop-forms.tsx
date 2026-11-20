"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Share a ticket with the product team as product feedback (support → product loop). */
export function ShareWithProduct({ base, ticketId, products, features }: { base: string; ticketId: string; products: { id: string; name: string }[]; features: { id: string; title: string; productId: string | null }[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ productId: products[0]?.id ?? "", featureId: "", sentiment: "", summary: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!products.length) return <p className="text-xs text-muted-foreground">{t("support.productLoop.noProducts")}</p>;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Lightbulb aria-hidden />
        {t("support.productLoop.share")}
      </Button>
    );
  }
  const featureOptions = features.filter((x) => x.productId === f.productId);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`${base}/support/tickets/${ticketId}/product-feedback`, { body: f });
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field htmlFor="pf-product" label={t("support.productLoop.product")}>
        <Select id="pf-product" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value, featureId: "" })} required>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field htmlFor="pf-feature" label={t("support.productLoop.feature")}>
        <Select id="pf-feature" value={f.featureId} onChange={(e) => setF({ ...f, featureId: e.target.value })}>
          <option value="">{t("support.productLoop.noFeature")}</option>
          {featureOptions.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field htmlFor="pf-sentiment" label={t("support.productLoop.sentiment")}>
        <Select id="pf-sentiment" value={f.sentiment} onChange={(e) => setF({ ...f, sentiment: e.target.value })}>
          <option value="">{t("support.productLoop.sentimentAuto")}</option>
          {(["POSITIVE", "NEUTRAL", "NEGATIVE"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`support.productLoop.sentiments.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field htmlFor="pf-summary" label={t("support.productLoop.summary")} hint={t("support.productLoop.summaryHint")}>
        <Textarea id="pf-summary" rows={3} maxLength={5000} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      </Field>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !f.productId}>
          {t("support.productLoop.submit")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("support.productLoop.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Customer satisfaction rating on the public ticket page (1–5 stars, optional comment). */
export function CsatForm({ token, initial }: { token: string; initial: { score: number | null; comment: string | null } | null }) {
  const t = useT();
  const router = useRouter();
  const [score, setScore] = useState<number>(initial?.score ?? 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const shown = hover || score;
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!score) return;
        setBusy(true);
        setError(null);
        try {
          await api(`/api/v1/public/tickets/${token}/rating`, { body: { score, comment: comment || undefined } });
          setDone(true);
          router.refresh();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("support.csat.question")}</legend>
        <div className="flex gap-1" role="radiogroup" aria-label={t("support.csat.question")} onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={score === n}
              aria-label={t("support.csat.scoreLabel", { score: n })}
              className="grid size-11 place-items-center rounded-md transition-transform hover:bg-muted motion-safe:active:scale-90"
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(0)}
              onClick={() => {
                setScore(n);
                setDone(false);
              }}
            >
              <Star className={cn("size-7", n <= shown ? "fill-warning text-warning" : "text-muted-foreground")} aria-hidden />
            </button>
          ))}
        </div>
        {shown ? <p className="text-xs text-muted-foreground">{t(`support.csat.labels.${shown}`)}</p> : null}
      </fieldset>
      <Textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("support.csat.commentPlaceholder")} aria-label={t("support.csat.comment")} />
      <FormError error={error} />
      {done ? <Notice tone="success">{t("support.csat.thanks")}</Notice> : null}
      <div>
        <Button type="submit" disabled={busy || !score}>
          {initial?.score ? t("support.csat.update") : t("support.csat.submit")}
        </Button>
      </div>
    </form>
  );
}
