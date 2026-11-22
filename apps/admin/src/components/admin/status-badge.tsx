import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { tonesA } from "./status/a";
import { tonesB } from "./status/b";
import { tonesC } from "./status/c";
import { tonesD } from "./status/d";
import { tonesE } from "./status/e";
import { tonesF } from "./status/f";
import type { StatusTone, StatusToneMap } from "./status/types";

export type { StatusTone, StatusToneMap } from "./status/types";

/**
 * One tone registry for every status enum in the console (stream A). Streams add domains ONLY in
 * `./status/<stream>.ts`; domain names must be unique across streams.
 */
export const STATUS_TONES: StatusToneMap = { ...tonesA, ...tonesB, ...tonesC, ...tonesD, ...tonesE, ...tonesF };

export function statusTone(domain: string, value: string | null | undefined): StatusTone {
  return (value && STATUS_TONES[domain]?.[value]) || "neutral";
}

/** `<StatusBadge domain="subscription" value={s.status}>{t(`admin.subscriptions.status.${s.status}`)}</StatusBadge>` */
export function StatusBadge({ domain, value, pill = true, pulse, className, children }: { domain: string; value: string | null | undefined; pill?: boolean; pulse?: boolean; className?: string; children?: ReactNode }) {
  return (
    <Badge tone={statusTone(domain, value)} shape={pill ? "pill" : "default"} pulse={pulse} className={className}>
      {children ?? value}
    </Badge>
  );
}
