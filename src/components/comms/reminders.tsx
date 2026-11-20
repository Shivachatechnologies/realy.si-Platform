"use client";

import { useState } from "react";
import { BellPlus, BellRing, CalendarClock, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { isoToLocal, localToIso, useAction } from "./client";

export interface ReminderView {
  id: string;
  kind: string;
  title: string;
  remindAt: string;
  when: string;
  href: string | null;
  sent: boolean;
}

const PRESETS = [
  { key: "in1h", ms: 3_600_000 },
  { key: "tomorrow9", ms: null },
] as const;

/** Personal reminders + automatic meeting reminders, delivered as notifications by the worker. */
export function RemindersPanel({ base, reminders }: { base: string; reminders: ReminderView[] }) {
  const { t, locale } = useI18n();
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(() => isoToLocal(new Date(Date.now() + 3_600_000)));
  const { busy, error, run } = useAction();
  const upcoming = reminders.filter((r) => !r.sent);
  const sent = reminders.filter((r) => r.sent);
  const preset = (key: (typeof PRESETS)[number]["key"]) => {
    const d = new Date();
    if (key === "in1h") {
      d.setHours(d.getHours() + 1);
      return setAt(isoToLocal(d));
    }
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    setAt(isoToLocal(d));
  };
  return (
    <Card>
      <CardHeader title={t("communication.reminders.title")} description={t("communication.reminders.hint")} icon={<BellRing />} />
      <CardBody className="grid gap-4">
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(`${base}/comms/reminders`, { body: { title, remindAt: localToIso(at) } }), () => setTitle(""));
          }}
        >
          <Field label={t("communication.reminders.what")} htmlFor="rem-title">
            <Input id="rem-title" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} placeholder={t("communication.reminders.placeholder")} />
          </Field>
          <Field label={t("communication.reminders.when")} htmlFor="rem-at">
            <Input id="rem-at" type="datetime-local" value={at} required onChange={(e) => setAt(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" onClick={() => preset(p.key)} className="min-h-8 rounded-full border px-3 text-xs hover:border-primary/50 hover:text-primary">
                {t(`communication.reminders.presets.${p.key}`)}
              </button>
            ))}
          </div>
          <FormError error={error} />
          <Button type="submit" size="sm" disabled={busy || !title.trim() || !at}>
            <BellPlus aria-hidden /> {t("communication.reminders.add")}
          </Button>
        </form>
        {upcoming.length ? (
          <ul className="grid gap-2">
            {upcoming.map((r) => (
              <li key={r.id} className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
                {r.kind === "meeting" ? <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> : <BellRing className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
                <div className="min-w-0 flex-1">
                  {r.href ? (
                    <a href={`/${locale}${r.href}`} className="font-medium hover:underline">
                      {r.title}
                    </a>
                  ) : (
                    <p className="font-medium">{r.title}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{r.when}</p>
                </div>
                <Button type="button" size="sm" variant="ghost" aria-label={t("communication.reminders.remove")} disabled={busy} onClick={() => void run(() => api(`${base}/comms/reminders/${r.id}`, { method: "DELETE" }))}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("communication.reminders.empty")}</p>
        )}
        {sent.length ? (
          <div className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground">{t("communication.reminders.delivered")}</p>
            <ul className="grid gap-1">
              {sent.map((r) => (
                <li key={r.id} className={cn("flex items-center gap-2 text-xs text-muted-foreground")}>
                  <Check className="size-3.5 text-success" aria-hidden /> <span className="truncate">{r.title}</span> <span className="ms-auto shrink-0">{r.when}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
