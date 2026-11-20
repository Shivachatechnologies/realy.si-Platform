import { formatDate, formatNumber } from "@/i18n/format";
import { LOCALE_NAMES } from "@/i18n/config";
import { translatorFor } from "./render";
import { changeText, decisionText, departmentLabel, insightText, metricText } from "./format";
import type { BriefingData } from "./types";

/**
 * The optional AI summary: the model gets only the computed figures (formatted exactly as the reader sees them) and
 * its answer is accepted only when every number it contains appears in those figures — anything else is discarded.
 */

export const SUMMARY_SUBJECT = "briefing_report";
export const SUMMARY_MAX = 900;

/** The facts block given to the model, in the reader's language and number format. */
export function factsFor(d: BriefingData, locale: string, companyName: string): string {
  const { t, locale: l } = translatorFor(locale);
  const n = (v: number) => formatNumber(v, l);
  const f: string[] = [`${t(`briefing.kinds.${d.kind}`)} — ${companyName} — ${formatDate(d.generatedAt, l, d.timezone, { dateStyle: "long" })}`];
  if (d.workforce) {
    f.push(`AI tasks completed: ${n(d.workforce.completed)}; failed: ${n(d.workforce.failed)}; in progress: ${n(d.workforce.inProgress)}`);
    for (const dep of d.workforce.byDepartment.slice(0, 6)) f.push(`- ${departmentLabel(t, dep.department)}: ${n(dep.completed)} completed, ${n(dep.failed)} failed`);
    f.push(`Actions run automatically: ${n(d.workforce.autoExecuted)}; approved by people: ${n(d.workforce.approvedByPeople)}; rejected: ${n(d.workforce.rejected)}`);
  }
  const o = d.output;
  if (o.outreachEmails !== null) f.push(`Sales emails sent: ${n(o.outreachEmails)}`);
  if (o.campaignEmails !== null) f.push(`Marketing emails sent: ${n(o.campaignEmails)}`);
  if (o.postsPublished !== null) f.push(`Social posts published: ${n(o.postsPublished)}`);
  if (o.calls) f.push(`Calls completed: ${n(o.calls)}`);
  if (o.meetingsHeld !== null) f.push(`Meetings held: ${n(o.meetingsHeld)}`);
  if (o.newLeads !== null) f.push(`New leads: ${n(o.newLeads)}`);
  if (o.dealsWon) f.push(`Deals won: ${n(o.dealsWon.count)} (${metricText({ unit: "money", value: o.dealsWon.amountMinor }, l, d.currency)})`);
  for (const k of d.kpis) if (k.value !== null) f.push(`${t(k.labelKey)}: ${metricText(k, l, d.currency)}${changeText(k, l) ? ` (${changeText(k, l)} vs previous period)` : ""}`);
  const p = d.problems;
  f.push(`Failed AI tasks: ${n(p.failedTaskCount ?? 0)}; failed approved actions: ${n(p.failedApprovals ?? 0)}; failed sends: ${n(p.failedSends ?? 0)}; failed posts: ${n(p.failedPosts ?? 0)}; overdue work tasks: ${n(p.overdueTasks ?? 0)}; SLA breaches: ${n(p.slaBreaches ?? 0)}`);
  if (d.approvals) f.push(`Approvals waiting for the founder: ${n(d.approvals.pending)}${d.approvals.items.length ? ` — ${d.approvals.items.slice(0, 5).map((a) => a.summary).join("; ")}` : ""}`);
  f.push(`Today: ${n(d.today.meetings.length)} meetings, ${n(d.today.scheduledPosts ?? 0)} scheduled posts, ${n(d.today.campaigns.length)} email campaigns, ${n(d.today.sequenceSteps ?? 0)} sequence steps due`);
  if (d.insights) {
    if (d.insights.healthScore !== null) f.push(`Business health score: ${n(d.insights.healthScore)} of 100`);
    for (const i of d.insights.items) f.push(`Risk/opportunity: ${insightText(t, i)}`);
  }
  d.decisions.forEach((x) => f.push(`Recommended decision: ${decisionText(t, x, l, d.currency)}`));
  return f.join("\n");
}

export function summaryInstructions(d: BriefingData, locale: string, companyName: string): string {
  const lang = LOCALE_NAMES[translatorFor(locale).locale as keyof typeof LOCALE_NAMES] ?? "English";
  return [
    `Write the opening summary of the founder's ${d.kind.toLowerCase()} briefing in ${lang}: 3 to 5 short sentences, at most ${SUMMARY_MAX - 200} characters, plain words, no headings, no lists, no markdown.`,
    "Say what matters most, what needs the founder, and the single most important next step.",
    "Use ONLY the facts below. Copy any number exactly as written there; never compute, round, estimate or add numbers that are not listed. Do not call tools, do not delegate, do not take any action. If the facts are thin, say so briefly.",
    `Facts (computed by Realy):\n${factsFor(d, locale, companyName)}`,
  ].join("\n\n");
}

const ZEROS = [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xff10];
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (c) => {
    const cp = c.codePointAt(0)!;
    const z = ZEROS.find((zero) => cp >= zero && cp <= zero + 9);
    return z === undefined ? c : String(cp - z);
  });
}

/** Every number in a text as a separator-free digit string ("1.234,50" → "123450"). */
export function numbersIn(text: string): string[] {
  return (asciiDigits(text).match(/\d(?:[\d.,'   ]*\d)?/g) ?? []).map((m) => m.replace(/[^\d]/g, "")).filter(Boolean);
}

/** The summary to keep, or null when it contains a number that is not in the facts (or is empty). */
export function acceptSummary(output: string | null | undefined, facts: string): string | null {
  const text = (output ?? "").replace(/[#*_`>]/g, "").trim();
  if (!text) return null;
  const allowed = new Set(numbersIn(facts));
  for (const num of numbersIn(text)) {
    if (allowed.has(num)) continue;
    // Small counting words written as digits ("2 things") and ordinals stay allowed.
    if (num.length <= 1) continue;
    // A number may also be part of a listed figure (e.g. "1.234" of "1.234,50 €").
    if ([...allowed].some((a) => a.startsWith(num) && num.length >= 3)) continue;
    return null;
  }
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
}
