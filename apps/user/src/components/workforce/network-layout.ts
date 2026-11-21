/**
 * Layout of the live company network (pure, client-safe): a radial tree from the REAL reporting lines. The AI CEO
 * sits at the centre of the upper plane with executives, managers and specialists on rings sized to fit their
 * count; the human team (and the founder) form their own radial tree on a lower plane. Hybrid lines (an AI employee
 * reporting to a person) connect the two planes.
 */

export type NetLevel = "CEO" | "EXECUTIVE" | "MANAGER" | "SPECIALIST" | "HUMAN";

export interface NetNode {
  id: string;
  kind: "ai" | "human";
  name: string;
  initials: string;
  level: NetLevel;
  department: string;
  title: string | null;
  profileKey: string | null;
  status: "active" | "busy" | "paused" | "away";
  managerId: string | null;
  depth: number;
}

export interface Placed {
  node: NetNode;
  x: number;
  y: number;
  z: number;
}

export interface NetLayout {
  placed: Placed[];
  index: Map<string, number>;
  /** Pairs of indices into `placed` (manager → report). */
  edges: [number, number][];
  radius: number;
}

const SPACING = 0.9;
const RING_GAP = 2.4;
const HEIGHT: Record<NetLevel, number> = { CEO: 1.6, EXECUTIVE: 1.0, MANAGER: 0.45, SPECIALIST: 0, HUMAN: -3.2 };

function radialTree(roots: string[], children: Map<string, string[]>, place: (id: string, angle: number, depth: number, ringRadius: (d: number) => number) => void) {
  // Leaf weights for angular partition.
  const weight = new Map<string, number>();
  const depthCount = new Map<number, number>();
  const stack: { id: string; depth: number; done: boolean }[] = roots.map((id) => ({ id, depth: roots.length > 1 ? 1 : 0, done: false }));
  const seen = new Set<string>();
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    if (!top.done) {
      top.done = true;
      if (seen.has(top.id)) {
        stack.pop();
        continue;
      }
      seen.add(top.id);
      depthCount.set(top.depth, (depthCount.get(top.depth) ?? 0) + 1);
      for (const c of children.get(top.id) ?? []) if (!seen.has(c)) stack.push({ id: c, depth: top.depth + 1, done: false });
    } else {
      stack.pop();
      const kids = (children.get(top.id) ?? []).filter((c) => weight.has(c));
      weight.set(top.id, Math.max(1, kids.reduce((a, c) => a + weight.get(c)!, 0)));
    }
  }
  // Ring radius fits the number of nodes at that depth.
  const ringRadius = (d: number) => (d === 0 ? 0 : Math.max(d * RING_GAP, ((depthCount.get(d) ?? 1) * SPACING) / (2 * Math.PI)));
  const total = roots.reduce((a, r) => a + (weight.get(r) ?? 1), 0);
  let start = 0;
  const visit = (id: string, a0: number, a1: number, depth: number, guard: Set<string>) => {
    if (guard.has(id)) return;
    guard.add(id);
    place(id, (a0 + a1) / 2, depth, ringRadius);
    const kids = (children.get(id) ?? []).filter((c) => weight.has(c) && !guard.has(c));
    const w = kids.reduce((a, c) => a + weight.get(c)!, 0) || 1;
    let s = a0;
    for (const c of kids) {
      const span = ((a1 - a0) * weight.get(c)!) / w;
      visit(c, s, s + span, depth + 1, guard);
      s += span;
    }
  };
  const guard = new Set<string>();
  for (const r of roots) {
    const span = (2 * Math.PI * (weight.get(r) ?? 1)) / (total || 1);
    visit(r, start, start + span, roots.length > 1 ? 1 : 0, guard);
    start += span;
  }
}

export function layoutNetwork(nodes: NetNode[], centerId: string | null): NetLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const n of nodes) if (n.managerId && byId.has(n.managerId)) children.set(n.managerId, [...(children.get(n.managerId) ?? []), n.id]);
  // Upper plane: the AI tree under the CEO (and other AI roots); lower plane: humans (and their trees).
  const aiRoots = nodes.filter((n) => n.kind === "ai" && (!n.managerId || !byId.has(n.managerId) || byId.get(n.managerId)!.kind === "human")).map((n) => n.id);
  const ordered = centerId && aiRoots.includes(centerId) ? [centerId, ...aiRoots.filter((r) => r !== centerId)] : aiRoots;
  const aiChildren = new Map([...children].map(([k, v]) => [k, v.filter((c) => byId.get(c)?.kind === "ai")]));
  const humanChildren = new Map([...children].map(([k, v]) => [k, v.filter((c) => byId.get(c)?.kind === "human")]));
  const humanRoots = nodes.filter((n) => n.kind === "human" && (!n.managerId || !byId.has(n.managerId))).map((n) => n.id);
  const pos = new Map<string, { x: number; y: number; z: number }>();
  const placeOn = (plane: "ai" | "human") => (id: string, angle: number, depth: number, ring: (d: number) => number) => {
    const n = byId.get(id)!;
    const r = ring(depth);
    pos.set(id, { x: Math.cos(angle) * r, y: HEIGHT[plane === "human" ? "HUMAN" : n.level] - (plane === "ai" ? Math.min(depth, 4) * 0.08 : 0), z: Math.sin(angle) * r });
  };
  // The CEO alone at the centre; other AI roots (no manager) get their own ring sector.
  if (ordered.length) {
    const center = ordered[0]!;
    pos.set(center, { x: 0, y: HEIGHT.CEO, z: 0 });
    const rest = ordered.slice(1);
    const sub = new Map(aiChildren);
    sub.set("__virtual__", [...(aiChildren.get(center) ?? []), ...rest]);
    radialTree(["__virtual__"], sub, (id, angle, depth, ring) => {
      if (id === "__virtual__") return;
      placeOn("ai")(id, angle, depth, ring);
    });
  }
  if (humanRoots.length) radialTree(humanRoots, humanChildren, placeOn("human"));
  const placed: Placed[] = [];
  const index = new Map<string, number>();
  for (const n of nodes) {
    const p = pos.get(n.id) ?? { x: 0, y: n.kind === "human" ? HEIGHT.HUMAN : 0, z: 0 };
    index.set(n.id, placed.length);
    placed.push({ node: n, ...p });
  }
  const edges: [number, number][] = [];
  for (const n of nodes) if (n.managerId && index.has(n.managerId)) edges.push([index.get(n.managerId)!, index.get(n.id)!]);
  const radius = Math.max(4, ...placed.map((p) => Math.hypot(p.x, p.z)));
  return { placed, index, edges, radius };
}

/** Department hue (stable): used for node colour in 2D and 3D. */
const DEPT_HUE: Record<string, number> = { executive: 265, sales: 150, marketing: 330, finance: 200, hr: 25, engineering: 230, product: 290, support: 175, operations: 55, research: 100 };
export const hueOf = (department: string) => DEPT_HUE[department] ?? (([...department].reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 360);

export const SIZE: Record<NetLevel, number> = { CEO: 0.55, EXECUTIVE: 0.36, MANAGER: 0.26, SPECIALIST: 0.17, HUMAN: 0.22 };
