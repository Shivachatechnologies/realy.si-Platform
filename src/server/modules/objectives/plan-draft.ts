import type { DraftObjective } from "@/components/objectives/plan-review";
import type { AiPlan } from "./plan";

/** Turn the AI's plan into an editable draft: stable item keys, dates from offsets, departments and owners matched. */

interface Person {
  userId: string;
  departmentId: string | null;
  title: string | null;
  isHead: boolean;
}

const DAY = 86_400_000;
const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

export function buildDraft(
  plan: AiPlan,
  opts: {
    today: Date;
    goalTarget: Date | null;
    departments: { id: string; name: string }[];
    /** Employees linked to users (null when the viewer may not read HR data). */
    employees: Person[] | null;
    objectiveOwnerIds: Set<string>;
    workPeopleIds: Set<string>;
    metricKeys: Map<string, string>;
  },
): DraftObjective[] {
  const day = (offset: number | undefined, fallback: Date | null = null) => {
    const d = offset !== undefined ? new Date(opts.today.getTime() + offset * DAY) : fallback;
    return d ? d.toISOString().slice(0, 10) : "";
  };
  const deptId = (name?: string) => opts.departments.find((d) => norm(d.name) === norm(name))?.id ?? "";
  const pick = (department: string | undefined, role: string | undefined, allowed: Set<string>) => {
    const people = (opts.employees ?? []).filter((e) => allowed.has(e.userId));
    const dept = deptId(department);
    const r = norm(role);
    const roleMatch = (e: Person) => !!r && !!e.title && (norm(e.title).includes(r) || r.includes(norm(e.title)));
    const inDept = people.filter((e) => dept && e.departmentId === dept);
    return (inDept.find(roleMatch) ?? inDept.find((e) => e.isHead) ?? people.find(roleMatch) ?? inDept[0])?.userId ?? "";
  };
  const suggestion = (department?: string, role?: string) => [department, role].filter(Boolean).join(" · ");

  return plan.objectives.map((o, i) => ({
    key: `o${i}`,
    include: true,
    title: o.title,
    description: o.description ?? "",
    ownerId: pick(o.department, o.role, opts.objectiveOwnerIds),
    departmentId: deptId(o.department),
    startDate: day(0),
    targetDate: day(o.targetInDays, opts.goalTarget),
    suggestion: suggestion(o.department, o.role),
    keyResults: o.keyResults.map((kr, k) => {
      const known = kr.metricKey ? opts.metricKeys.has(kr.metricKey) : false;
      return {
        key: `o${i}.k${k}`,
        include: true,
        title: kr.title,
        source: known ? ("METRIC" as const) : ("MANUAL" as const),
        metricKey: known ? kr.metricKey! : "",
        unit: known ? "" : (kr.unit ?? ""),
        baseline: String(kr.baseline),
        target: String(kr.target),
        direction: kr.direction,
        convertedFrom: kr.metricKey && !known ? kr.metricKey : "",
      };
    }),
    milestones: o.milestones.map((m, mi) => ({
      key: `o${i}.m${mi}`,
      include: true,
      title: m.title,
      dueDate: day(m.dueInDays),
      project: m.project
        ? {
            key: `o${i}.m${mi}.p`,
            include: true,
            name: m.project.name,
            description: m.project.description ?? "",
            ownerId: pick(m.project.department, m.project.role, opts.workPeopleIds),
            dueDate: day(m.project.dueInDays ?? m.dueInDays),
            suggestion: suggestion(m.project.department, m.project.role),
            tasks: m.project.tasks.map((tk, ti) => ({
              key: `o${i}.m${mi}.p.t${ti}`,
              include: true,
              title: tk.title,
              description: tk.description ?? "",
              assigneeId: pick(tk.department, tk.role, opts.workPeopleIds),
              dueDate: day(tk.dueInDays),
              priority: tk.priority,
              suggestion: suggestion(tk.department, tk.role),
            })),
          }
        : null,
    })),
  }));
}
