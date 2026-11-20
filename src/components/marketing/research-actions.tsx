"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

const TYPES = ["BLOG", "SEO_ARTICLE", "LINKEDIN", "X", "INSTAGRAM", "NEWSLETTER", "VIDEO_SCRIPT", "THOUGHT_LEADERSHIP"] as const;

/** Turn one research finding into a content draft (with its sources in the brief) and open it. */
export function FindingToContent({ path, section, index, locale }: { path: string; section: "insights" | "opportunities" | "trends"; index: number; locale: string }) {
  const t = useT();
  const router = useRouter();
  const [type, setType] = useState<(typeof TYPES)[number]>("BLOG");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="inline-grid gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <Select aria-label={t("marketing.intelligence.detail.contentType")} value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])} className="h-8 w-auto text-xs">
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`marketing.contentType.${x}`)}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const c = await api<{ id: string }>(`${path}/content`, { body: { section, index, type } });
              router.push(`/${locale}/marketing/content/${c.id}`);
            } catch (err) {
              setError(err);
              setBusy(false);
            }
          }}
        >
          <FilePlus2 aria-hidden />
          {t("marketing.intelligence.detail.toContent")}
        </Button>
      </span>
      <FormError error={error} />
    </span>
  );
}

/** Add a KEYWORDS report's keywords to an SEO project (volumes stay empty until real rank data exists). */
export function KeywordsToSeo({ path, projects }: { path: string; projects: { id: string; name: string }[] }) {
  const t = useT();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  if (!projects.length) return <p className="text-xs text-muted-foreground">{t("marketing.intelligence.detail.noSeoProject")}</p>;
  return (
    <span className="inline-grid gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <Select aria-label={t("marketing.intelligence.detail.seoProject")} value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 w-auto">
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Button type="button" size="sm" disabled={busy || done || !projectId} onClick={() => void run(() => api(`${path}/seo`, { body: { projectId } }), () => setDone(true))}>
          <KeyRound aria-hidden />
          {done ? t("marketing.intelligence.detail.keywordsAdded") : t("marketing.intelligence.detail.toSeo")}
        </Button>
      </span>
      <FormError error={error} />
    </span>
  );
}
