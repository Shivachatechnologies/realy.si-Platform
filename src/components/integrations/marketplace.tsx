"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { PROVIDER_CATEGORIES } from "@/server/modules/integrations/catalog";

export interface MarketplaceItem {
  key: string;
  name: string;
  category: string;
  authType: string;
  status: "CONNECTED" | "ERROR" | null;
  account: string | null;
  configured: boolean;
}

const TONE = { CONNECTED: "success", ERROR: "danger" } as const;

/** Searchable, filterable grid of integrations. */
export function Marketplace({ locale, items, initialView }: { locale: string; items: MarketplaceItem[]; initialView: "all" | "connected" }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [view, setView] = useState(initialView);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (!category || i.category === category) &&
        (view === "all" || i.status) &&
        (!needle || i.name.toLowerCase().includes(needle) || i.key.includes(needle) || t(`integrations.providers.${i.key}.description`).toLowerCase().includes(needle)),
    );
  }, [items, q, category, view, t]);

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_10rem]">
        <Input type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder={t("integrations.searchPlaceholder")} aria-label={t("integrations.search")} />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("integrations.category")}>
          <option value="">{t("integrations.allCategories")}</option>
          {PROVIDER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`integrations.categories.${c}`)}
            </option>
          ))}
        </Select>
        <Select value={view} onChange={(e) => setView(e.target.value as "all" | "connected")} aria-label={t("integrations.view")}>
          <option value="all">{t("integrations.viewAll")}</option>
          <option value="connected">{t("integrations.viewConnected")}</option>
        </Select>
      </div>
      {shown.length === 0 ? (
        <Card>
          <p className="p-4 text-muted-foreground">{view === "connected" && !q && !category ? t("integrations.noneConnected") : t("common.noResults")}</p>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((i) => (
            <li key={i.key}>
              <Link href={`/${locale}/integrations/${i.key}`} className="block h-full rounded-lg border bg-surface p-4 transition-colors hover:bg-muted/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-sm font-semibold uppercase">
                      {i.name.slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.name}</p>
                      <p className="text-xs text-muted-foreground">{t(`integrations.categories.${i.category}`)}</p>
                    </div>
                  </div>
                  {i.status ? (
                    <Badge tone={TONE[i.status]}>
                      <StatusDot tone={TONE[i.status]} />
                      {t(`integrations.status.${i.status}`)}
                    </Badge>
                  ) : i.authType === "oauth2" && !i.configured ? (
                    <Badge>{t("integrations.needsSetup")}</Badge>
                  ) : null}
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{t(`integrations.providers.${i.key}.description`)}</p>
                {i.account ? <p className="mt-2 truncate text-xs text-muted-foreground">{i.account}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
