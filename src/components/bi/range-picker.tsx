"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { RANGE_KEYS, type RangeKey } from "@/server/modules/bi/range";

/** Date range selector bound to ?range=&from=&to= (custom ranges apply on submit). */
export function RangePicker({ range, from, to }: { range: RangeKey; from?: string; to?: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [key, setKey] = useState<RangeKey>(range);
  const [f, setF] = useState(from ?? "");
  const [tt, setT] = useState(to ?? "");

  function go(next: RangeKey, nf = f, nt = tt) {
    const q = new URLSearchParams(params.toString());
    q.set("range", next);
    if (next === "custom") {
      if (nf) q.set("from", nf);
      if (nt) q.set("to", nt);
    } else {
      q.delete("from");
      q.delete("to");
    }
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        go(key);
      }}
    >
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("analytics.range.label")}
        <Select
          value={key}
          className="h-8 w-40"
          onChange={(e) => {
            const next = e.target.value as RangeKey;
            setKey(next);
            if (next !== "custom") go(next);
          }}
        >
          {RANGE_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`analytics.range.${k}`)}
            </option>
          ))}
        </Select>
      </label>
      {key === "custom" ? (
        <>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("analytics.range.from")}
            <Input type="date" className="h-8 w-40" value={f} max={tt || undefined} onChange={(e) => setF(e.target.value)} required />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("analytics.range.to")}
            <Input type="date" className="h-8 w-40" value={tt} min={f || undefined} onChange={(e) => setT(e.target.value)} required />
          </label>
          <Button type="submit" size="sm">
            {t("analytics.range.apply")}
          </Button>
        </>
      ) : null}
    </form>
  );
}
