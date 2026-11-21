import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { Translate } from "@/i18n/translate";
import type { TaskFilters } from "@/server/modules/work/tasks";
import { PRIORITIES, TASK_STATUSES } from "./constants";

/** GET filter form for task lists (search, status, priority, assignee, label, sprint, due). */
export function TaskFilterBar({ t, path, filters, people, labels, sprints, projects }: { t: Translate; path: string; filters: TaskFilters; people: { id: string; name: string }[]; labels: string[]; sprints?: { id: string; name: string }[]; projects?: { id: string; name: string }[] }) {
  const filtered = !!(filters.q || filters.status || filters.priority || filters.assignee || filters.label || filters.sprint || filters.due || filters.open || (projects && filters.projectId));
  return (
    <form className="grid gap-2 border-b p-3 sm:grid-cols-4 lg:grid-cols-[minmax(0,1fr)_repeat(6,9.5rem)_auto]" action={path}>
      <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.searchTasks")} className="sm:col-span-4 lg:col-span-1" />
      {projects ? (
        <Select name="project" defaultValue={filters.projectId ?? ""} aria-label={t("work.task.project")}>
          <option value="">{t("work.allProjects")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("work.task.status")}>
        <option value="">{t("work.allStatuses")}</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`work.taskStatus.${s}`)}
          </option>
        ))}
      </Select>
      <Select name="priority" defaultValue={filters.priority ?? ""} aria-label={t("work.task.priority")}>
        <option value="">{t("work.allPriorities")}</option>
        {PRIORITIES.map((s) => (
          <option key={s} value={s}>
            {t(`work.priority.${s}`)}
          </option>
        ))}
      </Select>
      <Select name="assignee" defaultValue={filters.assignee ?? ""} aria-label={t("work.task.assignee")}>
        <option value="">{t("work.allAssignees")}</option>
        <option value="me">{t("work.mine")}</option>
        <option value="unassigned">{t("work.unassigned")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select name="due" defaultValue={filters.due ?? ""} aria-label={t("work.dueDate")}>
        <option value="">{t("work.due.any")}</option>
        <option value="overdue">{t("work.due.overdue")}</option>
        <option value="week">{t("work.due.week")}</option>
        <option value="none">{t("work.due.none")}</option>
      </Select>
      {labels.length ? (
        <Select name="label" defaultValue={filters.label ?? ""} aria-label={t("work.task.labels")}>
          <option value="">{t("work.allLabels")}</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      ) : null}
      {sprints?.length ? (
        <Select name="sprint" defaultValue={filters.sprint ?? ""} aria-label={t("work.task.sprint")}>
          <option value="">{t("work.board.allWork")}</option>
          <option value="backlog">{t("work.agile.backlog")}</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      ) : null}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="open" value="1" defaultChecked={filters.open} />
        {t("work.openOnly")}
      </label>
      <div className="flex gap-2">
        <input type="hidden" name="sort" value={filters.sort} />
        <input type="hidden" name="dir" value={filters.dir} />
        <Button type="submit" variant="secondary">
          {t("work.apply")}
        </Button>
        {filtered ? (
          <Link href={path} className="self-center text-xs text-muted-foreground hover:underline">
            {t("work.clear")}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
