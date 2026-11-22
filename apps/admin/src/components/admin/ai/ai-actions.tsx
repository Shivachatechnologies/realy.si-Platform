"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Ban, Brain, Copy, Pause, Play, PlusCircle, RotateCcw, Shuffle, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { ActionButton, ActionDialog, useAdminAction } from "../action-dialog";

/** AI task actions on the task detail page and list rows (platform.ai.manage; every action asks for a reason). */
export function TaskActions({ task, candidates = [], compact }: { task: { id: string; title: string; status: string }; candidates?: { id: string; name: string; profileKey: string }[]; compact?: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.ai.task.done") });
  const [employee, setEmployee] = useState(candidates[0]?.id ?? "");
  const base = `/api/v1/admin/ai/tasks/${task.id}`;
  const s = task.status;
  const btn = (action: string, label: string, icon: React.ReactNode, variant: "secondary" | "ghost" | "danger" = "secondary") => (
    <ActionDialog
      key={action}
      trigger={
        <Button size="sm" variant={variant}>
          {icon}
          {label}
        </Button>
      }
      title={`${label}: ${task.title}`}
      description={t(`admin.ai.task.${action}Hint`)}
      confirmLabel={label}
      danger={variant === "danger"}
      onConfirm={(reason) => run(`${base}/${action}`, "POST", { reason })}
    />
  );
  return (
    <div className="flex flex-wrap gap-2">
      {["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(s) ? btn("pause", t("admin.ai.task.pause"), <Pause />) : null}
      {s === "PAUSED" ? btn("resume", t("admin.ai.task.resume"), <Play />) : null}
      {["QUEUED", "RUNNING", "WAITING_APPROVAL", "PAUSED"].includes(s) ? btn("cancel", t("admin.ai.cancel"), <Ban />, compact ? "ghost" : "danger") : null}
      {["FAILED", "CANCELLED"].includes(s) ? btn("retry", t("admin.ai.retry"), <RotateCcw />) : null}
      {!compact && ["QUEUED", "PAUSED", "FAILED", "CANCELLED"].includes(s) ? (
        <ActionDialog
          trigger={
            <Button size="sm" variant="secondary" disabled={!candidates.length}>
              <Shuffle />
              {t("admin.ai.task.reassign")}
            </Button>
          }
          title={`${t("admin.ai.task.reassign")}: ${task.title}`}
          description={t("admin.ai.task.reassignHint")}
          confirmLabel={t("admin.ai.task.reassign")}
          canSubmit={!!employee}
          onConfirm={(reason) => run(`${base}/reassign`, "POST", { aiEmployeeId: employee, reason })}
        >
          <Field label={t("admin.aiWorkforce.employee")} htmlFor={`reassign-${task.id}`}>
            <Select id={`reassign-${task.id}`} value={employee} onChange={(e) => setEmployee(e.target.value)}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.profileKey}
                </option>
              ))}
            </Select>
          </Field>
        </ActionDialog>
      ) : null}
    </div>
  );
}

/** Platform override: reject one pending approval (typed REJECT). Approving stays a tenant decision. */
export function RejectApprovalButton({ approvalId, title }: { approvalId: string; title: string }) {
  const { t } = useI18n();
  return <ActionButton label={t("admin.ai.task.rejectApproval")} title={`${t("admin.ai.task.rejectApproval")}: ${title}`} description={t("admin.ai.task.rejectApprovalHint")} path={`/api/v1/admin/ai/approvals/${approvalId}/reject`} method="POST" phrase="REJECT" danger variant="ghost" />;
}

export function ResetBreakersButton({ provider, label }: { provider: string; label: string }) {
  const { t } = useI18n();
  return <ActionButton label={t("admin.aiRequests.resetBreakers")} title={`${t("admin.aiRequests.resetBreakers")}: ${label}`} description={t("admin.aiRequests.resetBreakersHint")} path={`/api/v1/admin/ai/providers/${provider}`} method="POST" />;
}

/** Employee lifecycle (disable = archive with typed name, enable = restore) and memory controls. */
export function EmployeeLifecycle({ employee }: { employee: { id: string; name: string; archived: boolean } }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.ai.task.done") });
  return employee.archived ? (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <ArchiveRestore />
          {t("admin.aiWorkforce.enable")}
        </Button>
      }
      title={`${t("admin.aiWorkforce.enable")}: ${employee.name}`}
      description={t("admin.aiWorkforce.enableHint")}
      confirmLabel={t("admin.aiWorkforce.enable")}
      onConfirm={(reason) => run(`/api/v1/admin/ai/employees/${employee.id}/lifecycle`, "POST", { action: "restore", reason })}
    />
  ) : (
    <ActionDialog
      trigger={
        <Button size="sm" variant="danger">
          <Archive />
          {t("admin.aiWorkforce.disable")}
        </Button>
      }
      title={`${t("admin.aiWorkforce.disable")}: ${employee.name}`}
      description={t("admin.aiWorkforce.disableHint")}
      confirmLabel={t("admin.aiWorkforce.disable")}
      phrase={employee.name}
      danger
      onConfirm={(reason, confirm) => run(`/api/v1/admin/ai/employees/${employee.id}/lifecycle`, "POST", { action: "archive", reason, confirm })}
    />
  );
}

export function EmployeeMemoryActions({ employeeId, memoryId }: { employeeId: string; memoryId?: string }) {
  const { t } = useI18n();
  const path = `/api/v1/admin/ai/employees/${employeeId}/memory`;
  return memoryId ? (
    <ActionButton label={t("admin.aiWorkforce.memoryDelete")} title={t("admin.aiWorkforce.memoryDelete")} path={path} method="POST" body={{ action: "delete", memoryId }} variant="ghost" />
  ) : (
    <ActionButton label={t("admin.aiWorkforce.memoryPurge")} title={t("admin.aiWorkforce.memoryPurge")} description={t("admin.aiWorkforce.memoryPurgeHint")} path={path} method="POST" body={{ action: "purge" }} phrase="PURGE" danger variant="danger" />
  );
}

/** Edit an AI employee's instructions, job title, manager and the member it acts as (workforce service rules apply). */
export function EmployeeProfileEditor({ employee, peers }: { employee: { id: string; name: string; instructions: string | null; jobTitle: string | null; managerEmployeeId: string | null; skills: string[] }; peers: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.ai.task.done") });
  const [instructions, setInstructions] = useState(employee.instructions ?? "");
  const [jobTitle, setJobTitle] = useState(employee.jobTitle ?? "");
  const [manager, setManager] = useState(employee.managerEmployeeId ?? "");
  const [skills, setSkills] = useState(employee.skills.join(", "));
  const body = () => {
    const b: Record<string, unknown> = {};
    if ((instructions.trim() || null) !== employee.instructions) b.instructions = instructions.trim() || null;
    if ((jobTitle.trim() || null) !== employee.jobTitle) b.jobTitle = jobTitle.trim() || null;
    if ((manager || null) !== employee.managerEmployeeId) b.managerEmployeeId = manager || null;
    const sk = skills
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (sk.join() !== employee.skills.join()) b.skills = sk;
    return b;
  };
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Brain />
          {t("admin.aiWorkforce.editProfile")}
        </Button>
      }
      title={t("admin.aiWorkforce.editProfileTitle", { name: employee.name })}
      description={t("admin.aiWorkforce.editProfileHint")}
      confirmLabel={t("common.save")}
      canSubmit={Object.keys(body()).length > 0}
      onConfirm={(reason) => run(`/api/v1/admin/ai/employees/${employee.id}`, "PUT", { ...body(), reason })}
    >
      <Field label={t("admin.aiWorkforce.instructions")} htmlFor={`ep-ins-${employee.id}`}>
        <Textarea id={`ep-ins-${employee.id}`} rows={6} maxLength={4000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.aiWorkforce.jobTitle")} htmlFor={`ep-jt-${employee.id}`}>
          <Input id={`ep-jt-${employee.id}`} maxLength={120} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </Field>
        <Field label={t("admin.aiWorkforce.manager")} htmlFor={`ep-mg-${employee.id}`}>
          <Select id={`ep-mg-${employee.id}`} value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">{t("admin.aiWorkforce.noManager")}</option>
            {peers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("admin.aiWorkforce.skills")} htmlFor={`ep-sk-${employee.id}`} hint={t("admin.aiWorkforce.skillsHint")}>
        <Input id={`ep-sk-${employee.id}`} value={skills} onChange={(e) => setSkills(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

const LEVELS = ["global", "organization", "department", "agent", "user", "provider", "model"] as const;

/** Create or edit one platform AI budget rule. */
export function BudgetRuleEditor({ rule, providers, models }: { rule?: { id: string; level: string; key: string; period: string; limitUsd: number; softPct: number; hard: boolean; note: string | null }; providers: string[]; models: string[] }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.ai.task.done") });
  const [level, setLevel] = useState(rule?.level ?? "global");
  const [key, setKey] = useState(rule?.key === "*" ? "" : (rule?.key ?? ""));
  const [period, setPeriod] = useState(rule?.period ?? "monthly");
  const [limit, setLimit] = useState(rule ? String(rule.limitUsd) : "");
  const [soft, setSoft] = useState(String(rule?.softPct ?? 80));
  const [hard, setHard] = useState(rule?.hard ?? true);
  const [note, setNote] = useState(rule?.note ?? "");
  const ok = Number(limit) > 0 && (level === "global" || key.trim().length > 0) && Number(soft) >= 1 && Number(soft) <= 100;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={rule ? "ghost" : "default"}>
          {rule ? null : <PlusCircle />}
          {rule ? t("admin.aiBudgets.edit") : t("admin.aiBudgets.add")}
        </Button>
      }
      title={rule ? t("admin.aiBudgets.edit") : t("admin.aiBudgets.add")}
      description={t("admin.aiBudgets.editorHint")}
      confirmLabel={t("common.save")}
      canSubmit={ok}
      onConfirm={(reason) => run("/api/v1/admin/ai/budgets", "PUT", { action: "upsert", ...(rule ? { id: rule.id } : {}), level, key: level === "global" ? "*" : key.trim(), period, limitUsd: Number(limit), softPct: Math.round(Number(soft)), hard, note: note.trim() || null, reason })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.aiBudgets.level")} htmlFor="bud-level">
          <Select id="bud-level" value={level} onChange={(e) => setLevel(e.target.value)} disabled={!!rule}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`admin.aiBudgets.levels.${l}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.aiBudgets.period")} htmlFor="bud-period">
          <Select id="bud-period" value={period} onChange={(e) => setPeriod(e.target.value)} disabled={!!rule}>
            <option value="daily">{t("admin.aiBudgets.daily")}</option>
            <option value="monthly">{t("admin.aiBudgets.monthly")}</option>
          </Select>
        </Field>
      </div>
      {level !== "global" ? (
        <Field label={t("admin.aiBudgets.key")} htmlFor="bud-key" hint={t(`admin.aiBudgets.keyHint.${level}`)}>
          {level === "provider" ? (
            <Select id="bud-key" value={key} onChange={(e) => setKey(e.target.value)} disabled={!!rule}>
              <option value="" />
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          ) : level === "model" ? (
            <Select id="bud-key" value={key} onChange={(e) => setKey(e.target.value)} disabled={!!rule}>
              <option value="" />
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          ) : (
            <Input id="bud-key" value={key} onChange={(e) => setKey(e.target.value)} disabled={!!rule} className="font-mono" spellCheck={false} />
          )}
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.aiBudgets.limitUsd")} htmlFor="bud-limit">
          <Input id="bud-limit" type="number" min={0.01} step="0.01" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Field label={t("admin.aiBudgets.softPct")} htmlFor="bud-soft" hint={t("admin.aiBudgets.softPctHint")}>
          <Input id="bud-soft" type="number" min={1} max={100} value={soft} onChange={(e) => setSoft(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={hard} onChange={(e) => setHard(e.target.checked)} />
        {t("admin.aiBudgets.hard")}
      </label>
      <Field label={t("admin.aiBudgets.note")} htmlFor="bud-note">
        <Input id="bud-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

export function DeleteBudgetRule({ id }: { id: string }) {
  const { t } = useI18n();
  return <ActionButton label={t("admin.aiBudgets.remove")} title={t("admin.aiBudgets.remove")} path="/api/v1/admin/ai/budgets" method="PUT" body={{ action: "delete", id }} variant="ghost" />;
}

/** Platform override of one tenant cost budget. */
export function TenantBudgetEditor({ budget }: { budget: { id: string; limitMicros: number; hardStop: boolean; label: string } }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.ai.task.done") });
  const [limit, setLimit] = useState(String(budget.limitMicros / 1_000_000));
  const [hard, setHard] = useState(budget.hardStop);
  return (
    <div className="flex justify-end gap-1">
      <ActionDialog
        trigger={
          <Button size="sm" variant="ghost">
            {t("admin.aiBudgets.edit")}
          </Button>
        }
        title={`${t("admin.aiBudgets.tenantEdit")}: ${budget.label}`}
        description={t("admin.aiBudgets.tenantEditHint")}
        confirmLabel={t("common.save")}
        canSubmit={Number(limit) > 0}
        onConfirm={(reason) => run(`/api/v1/admin/ai/budgets/tenant/${budget.id}`, "PUT", { action: "update", limitUsd: Number(limit), hardStop: hard, reason })}
      >
        <Field label={t("admin.aiBudgets.limitUsd")} htmlFor={`tb-${budget.id}`}>
          <Input id={`tb-${budget.id}`} type="number" min={0.01} step="0.01" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hard} onChange={(e) => setHard(e.target.checked)} />
          {t("admin.aiBudgets.hard")}
        </label>
      </ActionDialog>
      <ActionButton label={t("admin.aiBudgets.remove")} title={`${t("admin.aiBudgets.remove")}: ${budget.label}`} path={`/api/v1/admin/ai/budgets/tenant/${budget.id}`} method="PUT" body={{ action: "delete" }} variant="ghost" />
    </div>
  );
}

const OVERRIDE_TIERS = ["simple", "standard", "complex", "coding", "creative"] as const;

/** Set or clear one per-task-type routing override. */
export function TaskTierEditor({ taskTypes, current }: { taskTypes: string[]; current?: { taskType: string; tier: string } }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.ai.task.done") });
  const [taskType, setTaskType] = useState(current?.taskType ?? "");
  const [tier, setTier] = useState(current?.tier ?? "standard");
  if (current) return <ActionButton label={t("admin.aiModels.removeOverride")} title={`${t("admin.aiModels.removeOverride")}: ${current.taskType}`} path="/api/v1/admin/ai/task-tiers" method="PUT" body={{ taskType: current.taskType, tier: null }} variant="ghost" />;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <PlusCircle />
          {t("admin.aiModels.addTaskTier")}
        </Button>
      }
      title={t("admin.aiModels.addTaskTier")}
      description={t("admin.aiModels.taskTiersHint")}
      confirmLabel={t("common.save")}
      canSubmit={/^[a-z0-9_.:-]{2,80}$/.test(taskType)}
      onConfirm={(reason) => run("/api/v1/admin/ai/task-tiers", "PUT", { taskType, tier, reason })}
    >
      <Field label={t("admin.aiModels.taskType")} htmlFor="tt-type" hint={t("admin.aiModels.taskTypeHint")}>
        <Input id="tt-type" list="tt-types" value={taskType} onChange={(e) => setTaskType(e.target.value.trim())} className="font-mono" spellCheck={false} />
        <datalist id="tt-types">
          {taskTypes.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </Field>
      <Field label={t("admin.aiModels.tierLabel")} htmlFor="tt-tier">
        <Select id="tt-tier" value={tier} onChange={(e) => setTier(e.target.value)}>
          {OVERRIDE_TIERS.map((x) => (
            <option key={x} value={x}>
              {t(`admin.aiModels.tier.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

/** Platform actions on one workflow. Test and run perform real actions: typed RUN. */
export function WorkflowActions({ workflow }: { workflow: { id: string; name: string; status: string; published: boolean } }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.ai.task.done") });
  const path = `/api/v1/admin/workflows/${workflow.id}`;
  const s = workflow.status;
  const simple = (action: string, label: string, icon: React.ReactNode) => (
    <ActionDialog
      key={action}
      trigger={
        <Button size="sm" variant="secondary">
          {icon}
          {label}
        </Button>
      }
      title={`${label}: ${workflow.name}`}
      description={t(`admin.workflows.actions.${action}Hint`)}
      confirmLabel={label}
      onConfirm={(reason) => run(path, "POST", { action, reason })}
    />
  );
  return (
    <div className="flex flex-wrap gap-2">
      {s !== "ACTIVE" && s !== "ARCHIVED" && workflow.published ? simple("enable", t("admin.workflows.actions.enable"), <Play />) : null}
      {s === "ACTIVE" ? simple("pause", t("admin.workflows.actions.pause"), <Pause />) : null}
      {simple("clone", t("admin.workflows.actions.clone"), <Copy />)}
      {s !== "ARCHIVED"
        ? (["test", ...(workflow.published ? ["run"] : [])] as const).map((action) => (
            <ActionDialog
              key={action}
              trigger={
                <Button size="sm" variant="secondary">
                  <Zap />
                  {t(`admin.workflows.actions.${action}`)}
                </Button>
              }
              title={`${t(`admin.workflows.actions.${action}`)}: ${workflow.name}`}
              description={t(`admin.workflows.actions.${action}Hint`)}
              confirmLabel={t(`admin.workflows.actions.${action}`)}
              phrase="RUN"
              danger
              onConfirm={(reason, confirm) => run(path, "POST", { action, reason, confirm, data: {} })}
            >
              <Notice tone="warning">{t("admin.workflows.actions.realActions")}</Notice>
            </ActionDialog>
          ))
        : null}
      {s !== "ARCHIVED" ? (
        <ActionDialog
          trigger={
            <Button size="sm" variant="danger">
              <Archive />
              {t("admin.workflows.actions.archive")}
            </Button>
          }
          title={`${t("admin.workflows.actions.archive")}: ${workflow.name}`}
          description={t("admin.workflows.actions.archiveHint")}
          confirmLabel={t("admin.workflows.actions.archive")}
          phrase={workflow.name}
          danger
          onConfirm={(reason, confirm) => run(path, "POST", { action: "archive", reason, confirm })}
        />
      ) : null}
    </div>
  );
}

export function WorkflowRunActions({ run: r }: { run: { id: string; status: string } }) {
  const { t } = useI18n();
  const path = `/api/v1/admin/workflows/runs/${r.id}`;
  return (
    <div className="flex gap-2">
      {r.status === "QUEUED" || r.status === "WAITING" ? <ActionButton label={t("admin.ai.cancel")} title={t("admin.ai.cancel")} path={path} method="POST" body={{ action: "cancel" }} /> : null}
      {r.status === "FAILED" || r.status === "CANCELLED" ? <ActionButton label={t("admin.ai.retry")} title={t("admin.ai.retry")} path={path} method="POST" body={{ action: "retry" }} /> : null}
    </div>
  );
}

/** Knowledge actions for one company of one organization. */
export function KnowledgeActions({ organizationId, organizationName, companyId, canExport }: { organizationId: string; organizationName: string; companyId: string; canExport: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.ai.task.done") });
  const [scope, setScope] = useState("documents");
  const [error, setError] = useState<string | null>(null);
  const path = `/api/v1/admin/knowledge/${organizationId}`;
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton label={t("admin.knowledge.reindex")} title={t("admin.knowledge.reindex")} description={t("admin.knowledge.reindexHint")} path={path} method="POST" body={{ action: "reindex", companyId }} />
      {canExport ? (
        <ActionDialog
          trigger={
            <Button size="sm" variant="secondary">
              {t("admin.knowledge.export")}
            </Button>
          }
          title={t("admin.knowledge.export")}
          description={t("admin.knowledge.exportHint")}
          confirmLabel={t("admin.knowledge.export")}
          onConfirm={async (reason) => {
            setError(null);
            const res = await fetch(`${path}/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, reason }) });
            if (!res.ok) {
              setError(t("admin.knowledge.exportFailed"));
              throw new Error(t("admin.knowledge.exportFailed"));
            }
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "knowledge.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        />
      ) : null}
      <ActionDialog
        trigger={
          <Button size="sm" variant="danger">
            <Trash2 />
            {t("admin.knowledge.purge")}
          </Button>
        }
        title={t("admin.knowledge.purge")}
        description={t("admin.knowledge.purgeHint")}
        confirmLabel={t("admin.knowledge.purge")}
        phrase={organizationName}
        danger
        onConfirm={(reason, confirm) => run(path, "POST", { action: "purge", companyId, scope, reason, confirm })}
      >
        <Field label={t("admin.knowledge.purgeScope")} htmlFor="kn-scope">
          <Select id="kn-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            {(["documents", "memories", "employeeMemories", "all"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`admin.knowledge.scopes.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </ActionDialog>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function KnowledgeDocumentDelete({ organizationId, companyId, documentId }: { organizationId: string; companyId: string; documentId: string }) {
  const { t } = useI18n();
  return <ActionButton label={t("admin.knowledge.deleteDocument")} title={t("admin.knowledge.deleteDocument")} description={t("admin.knowledge.deleteDocumentHint")} path={`/api/v1/admin/knowledge/${organizationId}`} method="POST" body={{ action: "deleteDocument", companyId, documentId }} variant="ghost" />;
}

export function KnowledgeRetentionEditor({ organizationId, companyId, layer, retentionDays }: { organizationId: string; companyId: string; layer: string; retentionDays: number | null }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.ai.task.done") });
  const [days, setDays] = useState(retentionDays === null ? "" : String(retentionDays));
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost">
          {t("admin.aiBudgets.edit")}
        </Button>
      }
      title={`${t("admin.knowledge.retention")}: ${layer}`}
      description={t("admin.knowledge.retentionHint")}
      confirmLabel={t("common.save")}
      canSubmit={days === "" || (Number(days) >= 1 && Number(days) <= 3650)}
      onConfirm={(reason) => run(`/api/v1/admin/knowledge/${organizationId}`, "POST", { action: "retention", companyId, layer, retentionDays: days === "" ? null : Math.round(Number(days)), reason })}
    >
      <Field label={t("admin.knowledge.retentionDays")} htmlFor={`ret-${layer}`} hint={t("admin.knowledge.retentionDaysHint")}>
        <Input id={`ret-${layer}`} type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}
