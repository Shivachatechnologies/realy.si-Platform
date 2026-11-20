import { Briefcase, CalendarOff, UserPlus, Users } from "lucide-react";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { cn } from "@/lib/utils";

/** Stable hue per person so the same name always gets the same avatar colour. */
function hue(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function initials(first: string, last?: string | null) {
  const a = Array.from(first.trim())[0] ?? "";
  const b = last ? (Array.from(last.trim())[0] ?? "") : (Array.from(first.trim())[1] ?? "");
  return `${a}${b}`.toUpperCase();
}

/** Round avatar with initials (people-centric visuals; no photos needed). */
export function Avatar({ first, last, size = "md", ring, className }: { first: string; last?: string | null; size?: "sm" | "md" | "lg"; ring?: "success" | "warning" | "info"; className?: string }) {
  const h = hue(`${first} ${last ?? ""}`);
  const dim = { sm: "size-7 text-[10px]", md: "size-9 text-xs", lg: "size-12 text-sm" }[size];
  const ringCls = ring ? { success: "ring-2 ring-success/60", warning: "ring-2 ring-warning/60", info: "ring-2 ring-info/60" }[ring] : "";
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white shadow-elev-1 ring-offset-2 ring-offset-surface", dim, ringCls, className)}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.15 ${h}), oklch(0.52 0.16 ${(h + 40) % 360}))` }}
    >
      {initials(first, last)}
    </span>
  );
}

/** Team health strip: headcount, who is out today, open roles and people in the hiring pipeline. */
export function TeamHealthStrip({ data, labels, hrefs }: { data: { headcount: number; onboarding: number; onLeave: number; openRoles: number; applicants: number }; labels: { headcount: string; onboarding: (n: number) => string; onLeave: string; openRoles: string; applicants: string }; hrefs: { people: string; leave: string; hiring: string } }) {
  return (
    <StatGrid>
      <StatTile index={0} label={labels.headcount} value={data.headcount} hint={labels.onboarding(data.onboarding)} icon={<Users />} href={hrefs.people} />
      <StatTile index={1} label={labels.onLeave} value={data.onLeave} icon={<CalendarOff />} href={hrefs.leave} live={data.onLeave > 0} />
      <StatTile index={2} label={labels.openRoles} value={data.openRoles} icon={<Briefcase />} href={hrefs.hiring} highlight={data.openRoles > 0} />
      <StatTile index={3} label={labels.applicants} value={data.applicants} icon={<UserPlus />} href={hrefs.hiring} />
    </StatGrid>
  );
}

export { HiringFunnel } from "./hiring-funnel";
