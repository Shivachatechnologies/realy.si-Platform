"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { Box, Layers, Radio, Search, X } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { dialogOverlayClass } from "@/components/ui/dialog";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AiAvatar } from "./avatar";
import { NetworkCanvas2D } from "./network-canvas-2d";
import { layoutNetwork, type NetNode } from "./network-layout";
import { PULSE_COLOR, SIGNAL_KINDS, type Pulse, type SignalKind } from "./network-signals";

const Scene3D = dynamic(() => import("./network-scene-3d"), { ssr: false, loading: () => <div className="size-full animate-pulse rounded-xl bg-surface-2" /> });

export interface LiveGraphWire {
  nodes: NetNode[];
  centerId: string | null;
  counts: { ai: number; humans: number; busy: number; paused: number };
  humansVisible: boolean;
  generatedAt: string;
}
interface SignalWire {
  id: string;
  kind: SignalKind;
  from: string;
  to: string;
  at: string;
  label: string;
}

const POLL_MS = 10_000;
const GRAPH_MS = 60_000;

let glCache: boolean | null = null;
function webgl() {
  if (glCache !== null) return glCache;
  try {
    const c = document.createElement("canvas");
    glCache = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    glCache = false;
  }
  return glCache;
}
const noop = () => () => {};
/** 3D is the default where WebGL works and the screen is wide enough (null on the server). */
const capable3d = () => webgl() && window.innerWidth >= 640;

function subscribeTheme(cb: () => void) {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return () => {
    mql.removeEventListener("change", cb);
    mo.disconnect();
  };
}
const isDark = () => document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);

type EmployeeWire = {
  id: string;
  name: string;
  initials: string;
  profileKey: string;
  department: string;
  level: string;
  status: string;
  jobTitle: string | null;
  manager: { id: string; name: string } | null;
  responsibilities: string[];
  skills: string[];
  goals: string[];
  autonomy: string;
  personality: string | null;
  communicationStyle: string | null;
  timezone: string | null;
};
type HumanWire = { kind: "employee" | "member"; id: string; name: string; title: string | null; email: string | null; department: string | null; manager: { id: string; name: string } | null; aiReports: { id: string; name: string }[]; humanReports: { id: string; name: string }[] };

/**
 * The live company network: real hierarchy (AI + humans) in a holographic 3D view (2D canvas fallback), with live
 * signals from real events — the events SSE stream when it is available, else polling the signals endpoint every 10 s.
 * Clicking a node opens the real profile drawer.
 */
export function LiveNetworkView({ apiBase, initial }: { apiBase: string; initial: LiveGraphWire }) {
  const { t, locale } = useI18n();
  const reduced = useReducedMotion();
  const [graph, setGraph] = useState(initial);
  const [choice, setMode] = useState<"3d" | "2d" | null>(null);
  const [streamOk, setStreamOk] = useState(false);
  const [feed, setFeed] = useState<SignalWire[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(true);
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  const capable = useSyncExternalStore(noop, capable3d, () => null);
  const mode = choice ?? (capable === null ? null : capable && !reduced ? "3d" : "2d");
  const live: "stream" | "poll" | "paused" = !visible ? "paused" : streamOk ? "stream" : "poll";
  const [q, setQ] = useState("");
  const pulses = useRef<Pulse[]>([]);
  const since = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const box = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutNetwork(graph.nodes, graph.centerId), [graph]);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const fetchSignals = useCallback(async () => {
    try {
      const from = since.current ?? new Date(Date.now() - 60_000).toISOString();
      const r = await api<{ signals: SignalWire[]; now: string }>(`${apiBase}/workforce/network/signals?since=${encodeURIComponent(from)}`);
      since.current = r.now;
      const fresh = r.signals.filter((s) => !seen.current.has(s.id));
      if (!fresh.length) return;
      for (const s of fresh) seen.current.add(s.id);
      const L = layoutRef.current;
      const now = performance.now();
      fresh.forEach((s, k) => {
        const from = L.index.get(s.from);
        const to = L.index.get(s.to) ?? from;
        if (from !== undefined && to !== undefined) pulses.current.push({ from, to, kind: s.kind, start: now + k * 120 });
      });
      setFeed((f) => [...fresh.reverse(), ...f].slice(0, 30));
    } catch {
      // Network errors: the next tick retries.
    }
  }, [apiBase]);

  // Live signals: the events SSE stream (as a wake-up hint) with graceful fallback to polling every 10 s.
  useEffect(() => {
    if (!visible) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const poll = (ms: number) => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (!document.hidden) void fetchSignals();
      }, ms);
    };
    void fetchSignals();
    poll(POLL_MS);
    if (typeof EventSource !== "undefined") {
      try {
        es = new EventSource(`${apiBase}/events/stream`, { withCredentials: true });
        es.onopen = () => {
          setStreamOk(true);
          poll(POLL_MS * 3);
        };
        es.onmessage = () => {
          if (debounce) return;
          debounce = setTimeout(() => {
            debounce = null;
            void fetchSignals();
          }, 800);
        };
        es.onerror = () => {
          es?.close();
          es = null;
          setStreamOk(false);
          poll(POLL_MS);
        };
      } catch {
        es = null;
      }
    }
    return () => {
      es?.close();
      setStreamOk(false);
      if (timer) clearInterval(timer);
      if (debounce) clearTimeout(debounce);
    };
  }, [apiBase, fetchSignals, visible]);

  // Structure (hires, pauses, reporting lines) refreshes every minute.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        setGraph(await api<LiveGraphWire>(`${apiBase}/workforce/network`));
      } catch {
        // keep the last graph
      }
    }, GRAPH_MS);
    return () => clearInterval(id);
  }, [apiBase, visible]);

  const onSelect = useCallback((i: number) => setSelected(layoutRef.current.placed[i]?.node.id ?? null), []);
  const onHover = useCallback((i: number | null, x: number, y: number) => setHover(i === null ? null : { i, x: Math.max(0, Math.min(x + 12, (box.current?.clientWidth ?? 400) - 240)), y }), []);
  const selectedIndex = selected ? (layout.index.get(selected) ?? null) : null;
  const hovered = hover ? layout.placed[hover.i]?.node : null;
  const levelLabel = (n: NetNode) => (n.kind === "human" ? t("workforce.network.human") : n.level === "CEO" ? t("workforce.network.ceo") : t(`workforce.levels.${n.level}.name`));
  const matches = q.trim() ? graph.nodes.filter((n) => n.name.toLowerCase().includes(q.trim().toLowerCase()) || (n.title ?? "").toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30) : [];
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? "—";

  if (!graph.nodes.length) {
    return (
      <Notice tone="info" title={t("workforce.network.emptyTitle")}>
        {t("workforce.network.empty")}{" "}
        <Link className="text-primary hover:underline" href={`/${locale}/workforce/designer`}>
          {t("workforce.designer.title")}
        </Link>
      </Notice>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={live === "stream" ? "success" : live === "poll" ? "info" : "neutral"} pulse={live !== "paused"}>
            <Radio aria-hidden className="size-3" />
            {t(`workforce.network.live.${live}`)}
          </Badge>
          <span className="text-xs text-muted-foreground">{t("workforce.network.counts", { ai: graph.counts.ai, humans: graph.counts.humans, busy: graph.counts.busy, paused: graph.counts.paused })}</span>
          <div className="ms-auto flex gap-1" role="group" aria-label={t("workforce.network.view")}>
            <Button type="button" size="sm" variant={mode === "3d" ? "default" : "secondary"} onClick={() => setMode("3d")} disabled={!capable} aria-pressed={mode === "3d"}>
              <Box aria-hidden />
              3D
            </Button>
            <Button type="button" size="sm" variant={mode === "2d" ? "default" : "secondary"} onClick={() => setMode("2d")} aria-pressed={mode === "2d"}>
              <Layers aria-hidden />
              2D
            </Button>
          </div>
        </div>
        <div ref={box} className="relative h-[62vh] min-h-[360px] overflow-hidden rounded-xl border bg-[radial-gradient(ellipse_at_center,var(--surface-2),var(--surface))]">
          {mode === "3d" ? <Scene3D layout={layout} pulsesRef={pulses} selected={selectedIndex} onSelect={onSelect} onHover={onHover} reduced={reduced} paused={!visible} dark={dark} /> : null}
          {mode === "2d" ? <NetworkCanvas2D layout={layout} pulsesRef={pulses} selected={selectedIndex} onSelect={onSelect} onHover={onHover} reduced={reduced} paused={!visible} dark={dark} /> : null}
          {hovered && hover ? (
            <div className="pointer-events-none absolute z-10 max-w-60 rounded-md border bg-surface/95 px-2 py-1 text-xs shadow-elev-2" style={{ left: hover.x, top: hover.y + 12 }}>
              <p className="font-medium">{hovered.name}</p>
              <p className="text-muted-foreground">
                {levelLabel(hovered)} · {hovered.title ?? (hovered.profileKey ? t(`profiles.${hovered.profileKey}.name`) : hovered.department)}
              </p>
            </div>
          ) : null}
          <ul className="absolute bottom-2 start-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-surface/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
            {SIGNAL_KINDS.map((k) => (
              <li key={k} className="inline-flex items-center gap-1">
                <span aria-hidden className="size-2 rounded-full" style={{ background: PULSE_COLOR[k] }} />
                {t(`workforce.network.signals.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">{t(mode === "2d" ? "workforce.network.hint2d" : "workforce.network.hint3d")}</p>
        {!graph.humansVisible ? <p className="text-xs text-muted-foreground">{t("workforce.network.humansHidden")}</p> : null}
      </div>
      <aside className="grid content-start gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="net-search" className="text-[13px] font-medium">
            {t("workforce.network.find")}
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="net-search" className="ps-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("workforce.network.findPlaceholder")} />
          </div>
          {matches.length ? (
            <ul className="grid max-h-56 gap-0.5 overflow-y-auto rounded-md border p-1">
              {matches.map((n) => (
                <li key={n.id}>
                  <button type="button" className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-start text-sm hover:bg-muted" onClick={() => setSelected(n.id)}>
                    <StatusDot tone={n.status === "busy" ? "success" : n.status === "paused" ? "neutral" : "info"} />
                    <span className="truncate">{n.name}</span>
                    <span className="ms-auto shrink-0 text-xs text-muted-foreground">{levelLabel(n)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <h2 className="text-sm font-semibold">{t("workforce.network.feed")}</h2>
          {feed.length ? (
            <ol className="grid gap-1 text-xs" aria-live="polite">
              {feed.map((s) => (
                <li key={s.id} className="flex items-start gap-2 rounded-md border px-2 py-1.5">
                  <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full" style={{ background: PULSE_COLOR[s.kind] }} />
                  <span className="min-w-0">
                    <span className="font-medium">{t(`workforce.network.signals.${s.kind}`)}</span> · {nameOf(s.from)}
                    {s.to !== s.from ? ` → ${nameOf(s.to)}` : ""}
                    <span className="block truncate text-muted-foreground">{s.label}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">{t("workforce.network.feedEmpty")}</p>
          )}
        </div>
      </aside>
      <ProfileDrawer apiBase={apiBase} nodeId={selected} node={selected ? (graph.nodes.find((n) => n.id === selected) ?? null) : null} onClose={() => setSelected(null)} />
    </div>
  );
}

function ProfileDrawer({ apiBase, nodeId, node, onClose }: { apiBase: string; nodeId: string | null; node: NetNode | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [loaded, setData] = useState<{ id: string; ai?: EmployeeWire; human?: HumanWire; error?: boolean } | null>(null);
  useEffect(() => {
    if (!nodeId) return;
    let off = false;
    const [kind, id] = nodeId.split(":");
    const url = kind === "ai" ? `${apiBase}/workforce/employees/${id}` : `${apiBase}/workforce/network/humans/${encodeURIComponent(nodeId)}`;
    api<EmployeeWire | HumanWire>(url)
      .then((r) => !off && setData(kind === "ai" ? { id: nodeId, ai: r as EmployeeWire } : { id: nodeId, human: r as HumanWire }))
      .catch(() => !off && setData({ id: nodeId, error: true }));
    return () => {
      off = true;
    };
  }, [apiBase, nodeId]);
  // Only show what was loaded for the node that is open now.
  const data = loaded && loaded.id === nodeId ? loaded : null;
  const e = data?.ai;
  const h = data?.human;
  return (
    <D.Root open={!!nodeId} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className={dialogOverlayClass} />
        <D.Content className="fixed inset-y-0 end-0 z-50 grid w-[min(420px,100%)] content-start gap-4 overflow-y-auto border-s glass-strong p-5 shadow-elev-4 outline-none data-[state=open]:animate-fade-in">
          <div className="flex items-start gap-3 pe-8">
            {node?.kind === "ai" && nodeId ? <AiAvatar id={nodeId.slice(3)} initials={node.initials} paused={node.status === "paused"} working={node.status === "busy"} size="lg" /> : <span className="grid size-12 place-items-center rounded-full bg-muted text-sm font-semibold">{node?.initials}</span>}
            <div className="min-w-0">
              <D.Title className="truncate text-base font-semibold">{node?.name ?? ""}</D.Title>
              <D.Description className="text-sm text-muted-foreground">{e ? (e.jobTitle ?? t(`profiles.${e.profileKey}.name`)) : (h?.title ?? (node?.kind === "human" ? t("workforce.network.human") : ""))}</D.Description>
            </div>
          </div>
          <D.Close className="absolute end-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label={t("common.close")}>
            <X className="size-4" />
          </D.Close>
          {!data ? <div className="h-32 animate-pulse rounded-md bg-surface-2" /> : null}
          {data?.error ? <Notice tone="warning">{t("workforce.network.profileUnavailable")}</Notice> : null}
          {e ? (
            <dl className="grid gap-3 text-sm">
              <Row label={t("workforce.record.department")}>{t(`workforce.departments.${e.department}`)}</Row>
              <Row label={t("workforce.record.level")}>{t(`workforce.levels.${e.level}.name`)}</Row>
              <Row label={t("workforce.record.status")}>{t(`workforce.status.${e.status}`)}</Row>
              <Row label={t("workforce.profile.reportsTo")}>{e.manager?.name ?? t("workforce.org.founder")}</Row>
              <Row label={t("workforce.form.autonomy")}>{t(`workforce.autonomy.${e.autonomy}.name`)}</Row>
              {e.responsibilities.length ? (
                <Row label={t("workforce.profile.responsibilities")}>
                  <ul className="list-disc ps-4">{e.responsibilities.slice(0, 6).map((r) => <li key={r}>{r}</li>)}</ul>
                </Row>
              ) : null}
              {e.skills.length ? <Row label={t("workforce.record.skills")}>{e.skills.join(", ")}</Row> : null}
              {e.personality ? <Row label={t("workforce.record.personality")}>{e.personality}</Row> : null}
              {e.communicationStyle ? <Row label={t("workforce.record.communicationStyle")}>{e.communicationStyle}</Row> : null}
              <Button asChild size="sm" className="justify-self-start">
                <Link href={`/${locale}/workforce/${e.id}`}>{t("workforce.network.openProfile")}</Link>
              </Button>
            </dl>
          ) : null}
          {h ? (
            <dl className="grid gap-3 text-sm">
              {h.department ? <Row label={t("workforce.record.department")}>{h.department}</Row> : null}
              {h.email ? <Row label={t("workforce.network.email")}>{h.email}</Row> : null}
              {h.manager ? <Row label={t("workforce.profile.reportsTo")}>{h.manager.name}</Row> : null}
              <Row label={t("workforce.network.aiReports")}>{h.aiReports.length ? h.aiReports.map((r) => r.name).join(", ") : t("common.none")}</Row>
              {h.humanReports.length ? <Row label={t("workforce.network.humanReports")}>{h.humanReports.map((r) => r.name).join(", ")}</Row> : null}
              {h.kind === "employee" ? (
                <Button asChild size="sm" variant="secondary" className="justify-self-start">
                  <Link href={`/${locale}/hr/employees/${h.id}`}>{t("workforce.network.openHr")}</Link>
                </Button>
              ) : null}
            </dl>
          ) : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn("grid gap-0.5")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
