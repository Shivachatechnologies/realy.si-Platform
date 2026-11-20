"use client";

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface Person {
  id: string;
  name: string;
}

/** Run a mutation, show its error, refresh server data on success. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<R>(fn: () => Promise<R>, after?: (r: R) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      router.refresh();
      return r;
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

/** One-click mutation button (optionally confirmed), e.g. delete, complete, mark read. */
export function ActionButton({
  path,
  method = "POST",
  body,
  confirm,
  children,
  variant = "secondary",
  size = "sm",
  redirectTo,
  className,
  onDone,
}: {
  path: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  confirm?: string;
  children: ReactNode;
  variant?: "default" | "secondary" | "ghost" | "danger" | "link";
  size?: "sm" | "default";
  redirectTo?: string;
  className?: string;
  onDone?: (r: unknown) => void;
}) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className={cn("inline-grid gap-1", className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={busy}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          void run(
            () => api(path, { method, body: body ?? (method === "DELETE" ? undefined : {}) }),
            (r) => {
              onDone?.(r);
              if (redirectTo) router.push(redirectTo);
            },
          );
        }}
      >
        {children}
      </Button>
      <FormError error={error} />
    </span>
  );
}

/**
 * Textarea with an @mention picker: typing "@" followed by letters suggests people; picking one inserts
 * "@[Name](id)", which the server resolves and notifies.
 */
export function MentionTextarea({ value, onChange, people, id, rows = 3, placeholder, maxLength = 5000, className, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  people: Person[];
  id?: string;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const matches = useMemo(() => (query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)), [people, query]);
  const detect = (v: string, caret: number) => {
    const m = v.slice(0, caret).match(/(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u);
    setQuery(m ? m[1]! : null);
  };
  const pick = (p: Person) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([\p{L}\p{N}._-]{0,30})$/u, `@[${p.name.replace(/[\[\]]/g, "")}](${p.id}) `);
    onChange(before + value.slice(caret));
    setQuery(null);
    requestAnimationFrame(() => el?.focus());
  };
  return (
    <div className="relative">
      <Textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery(null);
          if (e.key === "Enter" && matches.length && query !== null) {
            e.preventDefault();
            pick(matches[0]!);
          }
        }}
      />
      {matches.length ? (
        <ul role="listbox" className="absolute start-0 top-full z-20 mt-1 grid w-64 max-w-full overflow-hidden rounded-md border bg-surface shadow-lg">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-1.5 text-start text-sm hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Text composer (post, comment, message) with mentions. */
export function Composer({ path, people, placeholder, submitLabel, extraBody, rows = 3, onPosted, autoFocus }: {
  path: string;
  people: Person[];
  placeholder?: string;
  submitLabel: string;
  extraBody?: Record<string, unknown>;
  rows?: number;
  onPosted?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!text.trim()) return;
        void run(
          () => api(path, { body: { ...extraBody, body: text } }),
          () => {
            setText("");
            onPosted?.();
          },
        );
      }}
    >
      <MentionTextarea value={text} onChange={setText} people={people} placeholder={placeholder} rows={rows} autoFocus={autoFocus} />
      <FormError error={error} />
      <div>
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Edit-in-place for a text body (own posts, comments, messages). */
export function InlineEdit({ path, initial, people, onClose }: { path: string; initial: string; people: Person[]; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState(initial);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(path, { method: "PATCH", body: { body: text } }), onClose);
      }}
    >
      <MentionTextarea value={text} onChange={setText} people={people} rows={3} autoFocus />
      <FormError error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {t("common.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Buttons that start AI agent tasks on a record (results appear in the record's AI card). */
export function AiButtons({ path, modes, guidance = true }: { path: string; modes: { mode: string; label: string }[]; guidance?: boolean }) {
  const t = useT();
  const [text, setText] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      {guidance ? <Input value={text} maxLength={1000} placeholder={t("communication.ai.guidance")} onChange={(e) => setText(e.target.value)} aria-label={t("communication.ai.guidance")} /> : null}
      <div className="flex flex-wrap gap-2">
        {modes.map((m) => (
          <Button key={m.mode} type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(path, { body: { mode: m.mode, guidance: text || undefined } }), () => setText(""))}>
            <Sparkles aria-hidden />
            {m.label}
          </Button>
        ))}
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Searchable checkbox list of people. */
export function PeoplePicker({ people, value, onChange, exclude = [] }: { people: Person[]; value: string[]; onChange: (ids: string[]) => void; exclude?: string[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const shown = people.filter((p) => !exclude.includes(p.id) && p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="grid gap-1.5 rounded-md border p-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("communication.searchPeople")} aria-label={t("communication.searchPeople")} className="h-8" />
      <ul className="grid max-h-40 gap-0.5 overflow-y-auto">
        {shown.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
              <input type="checkbox" checked={value.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((v) => v !== p.id))} />
              {p.name}
            </label>
          </li>
        ))}
        {!shown.length ? <li className="px-1 text-xs text-muted-foreground">{t("common.noResults")}</li> : null}
      </ul>
      {value.length ? <p className="text-xs text-muted-foreground">{t("communication.selectedCount", { count: value.length })}</p> : null}
    </div>
  );
}

/** ISO instant from a datetime-local value (browser time zone). */
export const localToIso = (v: string) => (v ? new Date(v).toISOString() : "");
/** datetime-local value for an ISO instant in the browser's time zone. */
export function isoToLocal(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
