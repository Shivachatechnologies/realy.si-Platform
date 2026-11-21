import "server-only";
import { closestLocale, directionOf } from "@/i18n/config";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { createTranslator, type Messages, type Translate } from "@/i18n/translate";
import { escapeHtml } from "@/server/modules/email/service";
import enUS from "@/i18n/messages/en-US.json";
import hiIN from "@/i18n/messages/hi-IN.json";
import arAE from "@/i18n/messages/ar-AE.json";
import deDE from "@/i18n/messages/de-DE.json";
import zhCN from "@/i18n/messages/zh-CN.json";
import { changeText, decisionText, departmentLabel, insightText, metricText } from "./format";
import type { BriefingData } from "./types";

const CATALOGS: Record<string, Messages> = { "en-US": enUS, "hi-IN": hiIN as Messages, "ar-AE": arAE as Messages, "de-DE": deDE as Messages, "zh-CN": zhCN as Messages };

export function translatorFor(locale: string): { t: Translate; locale: string } {
  const l = closestLocale(locale);
  return { t: createTranslator(l, CATALOGS[l]), locale: l };
}

export interface RenderInput {
  data: BriefingData;
  summary: string | null;
  companyName: string;
  locale: string;
  /** Absolute link to the report in the app. */
  reportUrl: string;
  settingsUrl: string;
  /** Per approval ref: absolute decision link (single-use token). */
  links: Map<number, string>;
}

const titleKey = (kind: BriefingData["kind"]) => `briefing.kinds.${kind}`;

/** "Morning briefing — Acme — 20 Nov 2026". */
export function subjectOf(i: Pick<RenderInput, "data" | "companyName" | "locale">) {
  const { t, locale } = translatorFor(i.locale);
  return t("briefing.email.subject", { title: t(titleKey(i.data.kind)), company: i.companyName, date: formatDate(i.data.generatedAt, locale, i.data.timezone, { dateStyle: "medium" }) });
}

/** Plain-text lines shared by email text and WhatsApp (short form when `compact`). */
function lines(i: RenderInput, compact: boolean): string[] {
  const { t, locale } = translatorFor(i.locale);
  const d = i.data;
  const out: string[] = [];
  const n = (v: number) => formatNumber(v, locale);
  if (i.summary) out.push(`${t("briefing.aiLabel")}: ${compact ? i.summary.slice(0, 500) : i.summary}`, "");
  out.push(t(d.kind === "EVENING" ? "briefing.sections.today" : d.kind === "WEEKLY" ? "briefing.sections.week" : "briefing.sections.yesterday"));
  if (d.workforce) {
    out.push(`• ${t("briefing.line.aiWork", { completed: d.workforce.completed, failed: d.workforce.failed })}`);
    if (!compact) for (const dep of d.workforce.byDepartment.slice(0, 6)) out.push(`  – ${departmentLabel(t, dep.department)}: ${n(dep.completed)}${dep.failed ? ` (${t("briefing.line.failedShort", { count: dep.failed })})` : ""}`);
    if (d.workforce.autoExecuted || d.workforce.approvedByPeople) out.push(`• ${t("briefing.line.actions", { auto: d.workforce.autoExecuted, people: d.workforce.approvedByPeople })}`);
  }
  const o = d.output;
  const sent = [
    o.outreachEmails !== null || o.campaignEmails !== null ? t("briefing.line.emails", { count: (o.outreachEmails ?? 0) + (o.campaignEmails ?? 0) }) : null,
    o.postsPublished !== null ? t("briefing.line.posts", { count: o.postsPublished }) : null,
    o.calls ? t("briefing.line.calls", { count: o.calls }) : null,
    o.meetingsHeld !== null ? t("briefing.line.meetings", { count: o.meetingsHeld }) : null,
  ].filter(Boolean);
  if (sent.length) out.push(`• ${sent.join(" · ")}`);
  const results = [
    o.newLeads !== null ? t("briefing.line.leads", { count: o.newLeads }) : null,
    o.dealsWon ? t("briefing.line.deals", { count: o.dealsWon.count, amount: formatMoney({ amountMinor: BigInt(o.dealsWon.amountMinor), currency: d.currency }, locale) }) : null,
  ].filter(Boolean);
  if (results.length) out.push(`• ${results.join(" · ")}`);
  for (const k of d.kpis.filter((m) => m.value !== null).slice(0, compact ? 3 : 8)) {
    const c = changeText(k, locale);
    out.push(`• ${t(k.labelKey)}: ${metricText(k, locale, d.currency)}${c ? ` (${c})` : ""}`);
  }

  const p = d.problems;
  const problems = [
    p.failedTaskCount ? t("briefing.line.failedTasks", { count: p.failedTaskCount }) : null,
    p.failedApprovals ? t("briefing.line.failedActions", { count: p.failedApprovals }) : null,
    p.failedSends ? t("briefing.line.failedSends", { count: p.failedSends }) : null,
    p.failedPosts ? t("briefing.line.failedPosts", { count: p.failedPosts }) : null,
    p.overdueTasks ? t("briefing.line.overdue", { count: p.overdueTasks }) : null,
    p.slaBreaches ? t("briefing.line.sla", { count: p.slaBreaches }) : null,
  ].filter(Boolean);
  out.push("", t("briefing.sections.problems"));
  out.push(problems.length ? `• ${problems.join(" · ")}` : `• ${t("briefing.line.noProblems")}`);

  if (d.approvals) {
    out.push("", t("briefing.sections.approvalsCount", { count: d.approvals.pending }));
    for (const a of d.approvals.items.slice(0, compact ? 5 : 10)) {
      const link = i.links.get(a.ref);
      out.push(`${a.ref}) ${a.summary} [${t(`briefing.risk.${a.risk}`)}]${!compact && link ? `\n   ${link}` : ""}`);
    }
    if (compact && d.approvals.items.length) out.push(t("briefing.whatsapp.replyHint", { ref: d.approvals.items.find((a) => !a.needsMfa)?.ref ?? d.approvals.items[0]!.ref }));
  }

  const td = d.today;
  const plan = [
    td.meetings.length ? t("briefing.line.meetingsToday", { count: td.meetings.length }) : null,
    td.scheduledPosts ? t("briefing.line.postsToday", { count: td.scheduledPosts }) : null,
    td.campaigns.length ? t("briefing.line.campaignsToday", { count: td.campaigns.length }) : null,
    td.sequenceSteps ? t("briefing.line.sequenceSteps", { count: td.sequenceSteps }) : null,
    td.aiSchedules.length ? t("briefing.line.aiRuns", { count: td.aiSchedules.length }) : null,
    td.dueTasks ? t("briefing.line.dueTasks", { count: td.dueTasks }) : null,
  ].filter(Boolean);
  out.push("", t(d.kind === "EVENING" ? "briefing.sections.tomorrowish" : "briefing.sections.plan"));
  out.push(plan.length ? `• ${plan.join(" · ")}` : `• ${t("briefing.line.nothingScheduled")}`);
  if (!compact) for (const m of td.meetings.slice(0, 6)) out.push(`  – ${formatDate(m.startsAt, locale, d.timezone, { timeStyle: "short" })} ${m.title}`);

  if (d.insights?.items.length) {
    out.push("", t("briefing.sections.risks"));
    for (const ins of d.insights.items.slice(0, compact ? 2 : 5)) out.push(`• ${insightText(t, ins)}`);
  }
  if (d.decisions.length) {
    out.push("", t("briefing.sections.decisions"));
    d.decisions.forEach((x, idx) => out.push(`${idx + 1}. ${decisionText(t, x, locale, d.currency)}`));
  }
  return out;
}

export function renderText(i: RenderInput): string {
  const { t } = translatorFor(i.locale);
  return [subjectOf(i), "", ...lines(i, false), "", `${t("briefing.email.open")}: ${i.reportUrl}`, `${t("briefing.email.settings")}: ${i.settingsUrl}`].join("\n");
}

/** WhatsApp body (≤ 1600 characters: WhatsApp's per-message limit through Twilio). */
export function renderWhatsApp(i: RenderInput): string {
  const { t } = translatorFor(i.locale);
  const head = `*${subjectOf(i)}*`;
  const tail = `${t("briefing.email.open")}: ${i.reportUrl}`;
  let body = lines(i, true).join("\n");
  const room = 1600 - head.length - tail.length - 4;
  if (body.length > room) body = `${body.slice(0, room - 1)}…`;
  return `${head}\n\n${body}\n\n${tail}`;
}

/** Variables of the approved WhatsApp template: {{1}} title, {{2}} one-line headline, {{3}} link. */
export function templateVariables(i: RenderInput): string[] {
  const { t } = translatorFor(i.locale);
  const d = i.data;
  const headline = t("briefing.whatsapp.headline", { completed: d.workforce?.completed ?? 0, approvals: d.approvals?.pending ?? 0, problems: (d.problems.failedTaskCount ?? 0) + (d.problems.failedApprovals ?? 0) });
  return [subjectOf(i), headline, i.reportUrl];
}

export function renderHtml(i: RenderInput): string {
  const { t, locale } = translatorFor(i.locale);
  const d = i.data;
  const dir = directionOf(locale);
  const e = escapeHtml;
  const h2 = (s: string) => `<h2 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:20px;margin:28px 0 8px">${e(s)}</h2>`;
  const li = (s: string) => `<li style="margin:4px 0">${s}</li>`;
  const btn = (href: string, label: string, primary: boolean) =>
    `<a href="${e(href)}" style="display:inline-block;padding:8px 14px;border-radius:8px;text-decoration:none;font-size:14px;${primary ? "background:#111;color:#fff" : "border:1px solid #bbb;color:#111"}">${e(label)}</a>`;
  const figure = (label: string, value: string) => `<td style="padding:10px 12px;vertical-align:top"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#666">${e(label)}</div><div style="font-family:Georgia,serif;font-size:26px">${e(value)}</div></td>`;

  const parts: string[] = [];
  parts.push(`<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#666">${e(i.companyName)} · ${e(formatDate(d.generatedAt, locale, d.timezone, { dateStyle: "full" }))}</div>`);
  parts.push(`<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:32px;margin:6px 0 16px">${e(t(titleKey(d.kind)))}</h1>`);
  if (i.summary) parts.push(`<div style="border-inline-start:3px solid #7c5cff;padding:8px 14px;background:#f6f4ff;margin-bottom:12px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#5b45c7">${e(t("briefing.aiLabel"))}</div><p style="margin:6px 0 0">${e(i.summary).replace(/\n/g, "<br>")}</p></div>`);

  const revenue = d.kpis.find((k) => k.key === "finance.revenue");
  const figs = [
    d.workforce ? figure(t("briefing.figures.aiDone"), formatNumber(d.workforce.completed, locale)) : "",
    d.approvals ? figure(t("briefing.figures.waiting"), formatNumber(d.approvals.pending, locale)) : "",
    revenue ? figure(t(revenue.labelKey), metricText(revenue, locale, d.currency)) : "",
    d.insights?.healthScore !== null && d.insights?.healthScore !== undefined ? figure(t("briefing.figures.health"), String(d.insights.healthScore)) : "",
  ].join("");
  if (figs) parts.push(`<table role="presentation" style="border-collapse:collapse;width:100%;background:#fafafa;border-radius:10px"><tr>${figs}</tr></table>`);

  const textLines = lines({ ...i, summary: null }, false);
  // Approvals get buttons instead of raw links.
  const approvalsHtml = d.approvals?.items.length
    ? h2(t("briefing.sections.approvalsCount", { count: d.approvals.pending })) +
      d.approvals.items
        .map((a) => {
          const link = i.links.get(a.ref);
          return `<div style="border:1px solid #e5e5e5;border-radius:10px;padding:12px;margin:8px 0"><div style="font-size:12px;color:#666">#${a.ref} · ${e(t(`briefing.risk.${a.risk}`))}${a.needsMfa ? ` · ${e(t("briefing.needsMfa"))}` : ""}</div><div style="margin:4px 0 10px">${e(a.summary)}</div>${link ? `${btn(`${link}?d=approve`, t("briefing.approve"), true)} &nbsp; ${btn(`${link}?d=reject`, t("briefing.reject"), false)}` : ""}</div>`;
        })
        .join("")
    : "";
  // Everything else as readable sections (same content as the text version).
  const sections: string[] = [];
  let open = false;
  for (const raw of textLines) {
    if (/^\d+\) /.test(raw) || /^ {3}https?:/.test(raw) || raw.startsWith(t("briefing.sections.approvalsCount", { count: d.approvals?.pending ?? 0 }))) continue;
    if (!raw) continue;
    if (raw.startsWith("•") || raw.startsWith("  –") || /^\d+\. /.test(raw)) {
      if (!open) {
        sections.push(`<ul style="padding-inline-start:18px;margin:0">`);
        open = true;
      }
      sections.push(li(e(raw.replace(/^(•|\s+–)\s*/, ""))));
    } else {
      if (open) sections.push("</ul>");
      open = false;
      sections.push(h2(raw));
    }
  }
  if (open) sections.push("</ul>");
  parts.push(sections.join(""));
  parts.push(approvalsHtml);
  parts.push(`<p style="margin-top:28px">${btn(i.reportUrl, t("briefing.email.open"), true)}</p>`);
  parts.push(`<p style="color:#888;font-size:12px;margin-top:24px">${e(t("briefing.email.footer"))} <a href="${e(i.settingsUrl)}" style="color:#666">${e(t("briefing.email.settings"))}</a></p>`);
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#f2f2f2"><div style="max-width:640px;margin:0 auto;background:#fff;padding:28px 24px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#111">${parts.join("")}</div></body></html>`;
}
