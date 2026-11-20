import { Badge } from "@/components/ui/badge";
import type { Translate } from "@/i18n/translate";
import type { Manifest } from "@/server/modules/marketplace/manifest";

/** "What it installs": the structure a version creates, grouped by section. */
export function ManifestView({ manifest: m, t, locale }: { manifest: Manifest; t: Translate; locale: string }) {
  const block = (key: string, count: number, children: React.ReactNode, bridged = false) =>
    count ? (
      <section key={key} className="grid gap-1.5">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {t(`marketplace.sections.${key}`)} <span className="text-muted-foreground tabular">{count}</span>
          {bridged ? <Badge tone="warning">{t("marketplace.summary.bridged")}</Badge> : null}
        </h3>
        {children}
      </section>
    ) : null;
  const list = (items: React.ReactNode[]) => <ul className="grid gap-1 text-sm text-muted-foreground">{items}</ul>;
  const sections = [
    block(
      "departments",
      m.departments.length,
      list(
        m.departments.map((d) => (
          <li key={d.name}>
            <span className="text-foreground">{d.name}</span>
            {d.teams.length ? ` — ${d.teams.map((x) => x.name).join(", ")}` : ""}
          </li>
        )),
      ),
    ),
    block(
      "roles",
      m.roles.length,
      list(
        m.roles.map((r) => (
          <li key={r.key}>
            <span className="text-foreground">{r.name}</span> · {t("marketplace.permissionCount", { count: r.permissions.length })}
          </li>
        )),
      ),
    ),
    block(
      "projects",
      m.projects.length,
      list(
        m.projects.map((p) => (
          <li key={p.name}>
            <details>
              <summary className="cursor-pointer text-foreground">
                {p.name} <span className="text-muted-foreground">· {t("marketplace.taskCount", { count: p.tasks.length })}</span>
              </summary>
              <ul className="ms-4 mt-1 list-disc ps-2">
                {p.tasks.map((task) => (
                  <li key={task.title}>{task.title}</li>
                ))}
              </ul>
            </details>
          </li>
        )),
      ),
    ),
    block(
      "objectives",
      m.objectives.length,
      list(
        m.objectives.map((o) => (
          <li key={o.title}>
            <span className="text-foreground">{o.title}</span>
            {o.milestones.length ? ` — ${o.milestones.map((x) => x.title).join(" → ")}` : ""}
          </li>
        )),
      ),
    ),
    block(
      "workflows",
      m.workflows.length,
      list(
        m.workflows.map((w) => (
          <li key={w.key}>
            <span className="text-foreground">{w.name}</span> · <code className="text-xs">{w.trigger}</code>
          </li>
        )),
      ),
      true,
    ),
    block(
      "aiEmployees",
      m.aiEmployees.length,
      list(
        m.aiEmployees.map((e) => (
          <li key={e.name}>
            <span className="text-foreground">{e.name}</span>
            {e.description ? ` — ${e.description}` : ""}
          </li>
        )),
      ),
      true,
    ),
    block(
      "pipelines",
      m.pipelines.length,
      list(
        m.pipelines.map((p) => (
          <li key={p.name}>
            <span className="text-foreground">{p.name}</span> — {p.stages.join(" → ")}
          </li>
        )),
      ),
      true,
    ),
    block(
      "skills",
      m.skills.length,
      list(
        m.skills.map((s) => (
          <li key={s.key}>
            <span className="text-foreground">{s.name}</span>
            {s.description ? ` — ${s.description}` : ""}
          </li>
        )),
      ),
      true,
    ),
    block(
      "integrations",
      m.integrations.length,
      list(
        m.integrations.map((i) => (
          <li key={i.provider}>
            <span className="text-foreground">{i.name}</span>
            {i.description ? ` — ${i.description}` : ""}
          </li>
        )),
      ),
      true,
    ),
  ].filter(Boolean);
  const settings = m.settings.fiscalYearStartMonth || m.settings.currency;
  if (!sections.length && !settings) return <p className="text-sm text-muted-foreground">{t("marketplace.detail.installsNothing")}</p>;
  return (
    <div className="grid gap-4">
      {sections}
      {settings ? (
        <section className="grid gap-1">
          <h3 className="text-sm font-medium">{t("marketplace.sections.settings")}</h3>
          <p className="text-sm text-muted-foreground">
            {m.settings.fiscalYearStartMonth
              ? t("marketplace.detail.fiscalDefault", {
                  month: new Intl.DateTimeFormat(locale, {
                    month: "long",
                    timeZone: "UTC",
                  }).format(new Date(Date.UTC(2026, m.settings.fiscalYearStartMonth - 1, 1))),
                })
              : null}
          </p>
        </section>
      ) : null}
    </div>
  );
}
