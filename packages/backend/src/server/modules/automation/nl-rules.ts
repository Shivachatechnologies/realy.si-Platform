import { TRIGGER_EVENTS, type Action, type Definition, type Schedule, type Step, type Trigger, type TriggerEvent } from "./definition";

/**
 * Rule-based fallback for natural-language automation ("When a new lead comes in, research them, score them, assign them
 * and send me a notification"). Used when no AI text provider is connected (or the AI's design fails validation).
 * It recognises a fixed vocabulary of triggers and steps and reports every phrase it could NOT turn into a step, so the
 * result is always labelled as rule-based and never pretends to understand more than it did. Pure: no I/O.
 */

export interface RuleNote {
  /** The phrase as the person wrote it. */
  phrase: string;
  /** "trigger", a step id, or null when it was not understood. */
  target: string | null;
}

export interface RuleParse {
  name: string;
  definition: Definition;
  notes: RuleNote[];
  unmatched: string[];
}

type Entity = "lead" | "deal" | "ticket" | "work_task" | "employee" | "candidate" | "invoice" | "contact" | "project" | null;

const EVENT_RULES: { re: RegExp; event: TriggerEvent | string; entity: Entity; label: string }[] = [
  { re: /lead.{0,30}\bassigned/, event: "lead.assigned", entity: "lead", label: "Lead assigned" },
  { re: /lead.{0,30}\b(updated|changes|changed)/, event: "lead.updated", entity: "lead", label: "Lead updated" },
  { re: /\blead|\bsign[- ]?ups?\b|\benquir|\binquir|\bprospect/, event: "lead.created", entity: "lead", label: "New lead" },
  { re: /deal.{0,30}\b(won|closes? won)|\bwin (a|the) deal|\bclose (a|the) deal/, event: "deal.won", entity: "deal", label: "Deal won" },
  { re: /deal.{0,30}\blost|\blose (a|the) deal/, event: "deal.lost", entity: "deal", label: "Deal lost" },
  { re: /deal.{0,30}\b(stage|moves?|moved)/, event: "deal.stage_changed", entity: "deal", label: "Deal changes stage" },
  { re: /\bdeal/, event: "deal.created", entity: "deal", label: "New deal" },
  { re: /\bpayment.{0,20}\breceived|\breceive (a )?payment/, event: "payment.received", entity: "invoice", label: "Payment received" },
  { re: /invoice.{0,30}\b(is )?paid|\bgets? paid/, event: "invoice.paid", entity: "invoice", label: "Invoice paid" },
  { re: /invoice.{0,30}\boverdue|\boverdue invoice|\blate payment/, event: "invoice.overdue", entity: "invoice", label: "Invoice overdue" },
  { re: /invoice.{0,30}\bsent/, event: "invoice.sent", entity: "invoice", label: "Invoice sent" },
  { re: /\binvoice/, event: "invoice.created", entity: "invoice", label: "New invoice" },
  { re: /\bexpense/, event: "expense.created", entity: null, label: "New expense" },
  { re: /\bbecomes? a customer|\bnew customer|\bcustomer (is )?(created|added|signs)/, event: "customer.created", entity: null, label: "New customer" },
  { re: /\bcontact/, event: "contact.created", entity: "contact", label: "New contact" },
  { re: /\btask.{0,30}\b(completed|done|finished|closed)/, event: "task.completed", entity: "work_task", label: "Task completed" },
  { re: /\btask/, event: "task.created", entity: "work_task", label: "New task" },
  { re: /\bproject/, event: "project.created", entity: "project", label: "New project" },
  { re: /\b(employee|team member|someone|person).{0,20}\b(leaves|left|quits|offboard)/, event: "employee.left", entity: "employee", label: "Employee leaves" },
  { re: /\bnew (employee|hire|team member|starter)|\b(employee|someone|person).{0,20}\b(joins|starts|is hired)/, event: "employee.joined", entity: "employee", label: "Employee joins" },
  { re: /\bcandidate.{0,30}\bhired|\bhire (a|the) candidate/, event: "candidate.hired", entity: "candidate", label: "Candidate hired" },
  { re: /\bcandidate|\bappl(ies|ication)/, event: "candidate.applied", entity: "candidate", label: "Candidate applies" },
  { re: /\bleave request|\btime off|\bvacation|\bholiday request/, event: "leave.requested", entity: null, label: "Leave requested" },
  { re: /\bform/, event: "form.submitted", entity: null, label: "Form submitted" },
  { re: /\bcampaign/, event: "campaign.launched", entity: null, label: "Campaign launched" },
  { re: /\b(content|post|article|blog).{0,20}\bpublished/, event: "content.published", entity: null, label: "Content published" },
  { re: /\bticket.{0,30}\b(resolved|closed|solved)/, event: "ticket.resolved", entity: "ticket", label: "Ticket resolved" },
  { re: /\bticket.{0,30}\bupdated/, event: "ticket.updated", entity: "ticket", label: "Ticket updated" },
  { re: /\bticket|\bsupport request|\bcomplain|\bcustomer (asks|writes|reaches out)/, event: "ticket.created", entity: "ticket", label: "New support ticket" },
  { re: /\bmeeting/, event: "meeting.completed", entity: null, label: "Meeting completed" },
  { re: /\bannouncement/, event: "announcement.published", entity: null, label: "Announcement published" },
  { re: /\bai (task|employee).{0,30}\bfail/, event: "agent.task.failed", entity: null, label: "AI task failed" },
  { re: /\bai (task|employee).{0,30}\b(complete|finish|done)/, event: "agent.task.completed", entity: null, label: "AI task completed" },
  { re: /\bmilestone/, event: "milestone.completed", entity: null, label: "Milestone completed" },
  { re: /\b(objective|goal)/, event: "objective.created", entity: null, label: "New goal" },
];

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function timeOf(s: string, fallback = "09:00"): string {
  const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(s);
  if (!m) return /\bevening/.test(s) ? "18:00" : /\b(noon|lunch)/.test(s) ? "12:00" : /\bafternoon/.test(s) ? "14:00" : fallback;
  let h = Number(m[1]);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23) return fallback;
  return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
}

function scheduleOf(s: string): { schedule: Schedule; label: string } | null {
  const day = DAYS.findIndex((d) => new RegExp(`\\b(every|each|on) ${d}`).test(s));
  if (day >= 0) return { schedule: { kind: "weekly", day, time: timeOf(s) }, label: `Every ${DAYS[day]![0]!.toUpperCase()}${DAYS[day]!.slice(1)} at ${timeOf(s)}` };
  if (/\b(every|each) week\b|\bweekly\b/.test(s)) return { schedule: { kind: "weekly", day: 1, time: timeOf(s) }, label: `Every Monday at ${timeOf(s)}` };
  const hours = /\bevery (\d{1,3}) hours?\b/.exec(s);
  if (hours) return { schedule: { kind: "interval", minutes: Math.min(Math.max(Number(hours[1]) * 60, 15), 7 * 24 * 60) }, label: `Every ${hours[1]} hours` };
  if (/\b(every|each) hour\b|\bhourly\b/.test(s)) return { schedule: { kind: "interval", minutes: 60 }, label: "Every hour" };
  if (/\b(every|each) (day|morning|evening|night|weekday)\b|\bdaily\b/.test(s)) return { schedule: { kind: "daily", time: timeOf(s, /evening|night/.test(s) ? "18:00" : "09:00") }, label: `Every day at ${timeOf(s, /evening|night/.test(s) ? "18:00" : "09:00")}` };
  return null;
}

const ACTION_START =
  "research|look up|investigate|enrich|score|rate|qualify|grade|prioriti[sz]e|assign|route|give|send|notify|alert|tell|let|ping|email|e-mail|message|post|create|add|make|open|start|schedule|book|invite|onboard|move|mark|update|remind|follow up|wait|ask|get|request|summari[sz]e|draft|write|welcome|thank";

/** Split "research them, score them, assign them and send me a notification" into clauses. */
function clauses(rest: string): string[] {
  return rest
    .split(new RegExp(`\\s*(?:[,;.]|\\bthen\\b|\\band then\\b|\\band\\s+(?=(?:${ACTION_START})\\b))\\s*`, "i"))
    .map((c) => c.replace(/^(and|then|also|please|to)\s+/i, "").trim())
    .filter((c) => c.length > 1);
}

const ENTITY_HREF: Partial<Record<NonNullable<Entity>, string>> = {
  lead: "/crm/{{event.entityId}}",
  deal: "/crm/deals/{{event.entityId}}",
  ticket: "/support/tickets/{{event.entityId}}",
  project: "/projects/{{event.entityId}}",
};

const ASSIGN_POOL: Partial<Record<NonNullable<Entity>, { entity: "lead" | "deal" | "ticket" | "work_task"; permission: string }>> = {
  lead: { entity: "lead", permission: "sales.manage" },
  deal: { entity: "deal", permission: "sales.manage" },
  ticket: { entity: "ticket", permission: "support.manage" },
  work_task: { entity: "work_task", permission: "projects.manage" },
};

const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;

export function parseAutomationText(text: string, opts: { meId: string }): RuleParse {
  const raw = text.replace(/\s+/g, " ").trim();
  const lower = raw.toLowerCase();
  const notes: RuleNote[] = [];
  const unmatched: string[] = [];

  // ── Trigger ──
  const head = /^(?:when(?:ever)?|every ?time|each time|as soon as|once|after|if)\s+(.+?)(?:,|\s+then\s+|\s+-\s+|:|$)/i.exec(raw);
  let rest = raw;
  let trigger: Trigger = { type: "manual", filters: [] };
  let entity: Entity = null;
  let triggerLabel = "Run by hand";
  const sched = scheduleOf(lower);
  if (head) {
    const phrase = head[1]!;
    rest = raw.slice(head[0].length);
    const rule = EVENT_RULES.find((r) => r.re.test(phrase.toLowerCase()) && (TRIGGER_EVENTS as readonly string[]).includes(r.event));
    if (rule) {
      trigger = { type: "event", event: rule.event as TriggerEvent, filters: [] };
      entity = rule.entity;
      triggerLabel = rule.label;
      notes.push({ phrase, target: "trigger" });
    } else {
      unmatched.push(phrase);
    }
  } else if (sched) {
    trigger = { type: "schedule", schedule: sched.schedule, filters: [] };
    triggerLabel = sched.label;
    const m = /^(.*?\b(?:daily|hourly|weekly|every [a-z0-9 ]+?|each [a-z ]+?)(?:\s+at\s+[\d:apm ]+)?)(?:,|:|\s+-\s+)/i.exec(raw);
    if (m) rest = raw.slice(m[0].length);
    notes.push({ phrase: m?.[1] ?? sched.label, target: "trigger" });
  }

  // ── Steps ──
  const steps: Step[] = [];
  const ids = new Set<string>();
  const id = (base: string) => {
    let n = 1;
    let candidate = base;
    while (ids.has(candidate)) candidate = `${base}_${++n}`;
    ids.add(candidate);
    return candidate;
  };
  const push = (phrase: string, step: Step) => {
    steps.push(step);
    notes.push({ phrase, target: step.id });
  };
  const action = (phrase: string, base: string, a: Action) => push(phrase, { id: id(base), type: "action", action: a });
  const has = (prefix: string) => steps.find((s) => s.id.startsWith(prefix));
  const name = trigger.type !== "event" ? "" : entity === "work_task" || entity === "project" ? "{{event.data.title}}" : entity === "invoice" ? "{{event.data.number}}" : "{{event.data.name}}";
  const labelled = `${triggerLabel}${name ? `: ${name}` : ""}`;
  const subject = entity ? `${triggerLabel.toLowerCase()} ${name}` : triggerLabel.toLowerCase();
  const href = entity ? ENTITY_HREF[entity] : undefined;
  const assignee = () => {
    const a = has("assign");
    return a ? `{{steps.${a.id}.userId}}` : undefined;
  };

  for (const clause of clauses(rest)) {
    const c = clause.toLowerCase();
    const days = /\bin (\d{1,3}) days?\b/.exec(c)?.[1] ?? (/\btomorrow\b/.test(c) ? "1" : /\bnext week\b/.test(c) ? "7" : null);

    const wait = /\bwait (\d{1,3}) (minute|hour|day)s?|\bafter (\d{1,3}) (minute|hour|day)s?/.exec(c);
    if (wait) {
      const amount = Math.min(Math.max(Number(wait[1] ?? wait[3]), 1), 365);
      const unit = `${wait[2] ?? wait[4]}s` as "minutes" | "hours" | "days";
      push(clause, { id: id("wait"), type: "delay", amount, unit });
      continue;
    }
    if (/^(research|look up|investigate|enrich|find out)/.test(c)) {
      action(clause, "research", {
        kind: "assign_ai_employee",
        profile: entity === "lead" || entity === "deal" || entity === "contact" ? "sales_researcher" : "research_analyst",
        title: name ? `Research ${name}` : `Research: ${triggerLabel.toLowerCase()}`,
        instructions: `Research ${name || "this"} (${triggerLabel.toLowerCase()}${name ? ", record {{event.entityId}}" : ""}): who they are, their company, size, industry, recent news and how well they fit our ideal customer. Write a short, sourced brief. Do not contact them.`,
        wait: true,
      });
      continue;
    }
    if (/^(score|rate|qualify|grade|prioriti[sz]e|decide)/.test(c)) {
      const research = has("research");
      action(clause, "score", {
        kind: "ai_decision",
        profile: entity === "ticket" ? "support_lead" : entity === "lead" || entity === "deal" ? "sales_manager" : "operations_assistant",
        question: entity === "ticket" ? `How urgent is the ticket ${name}?` : name ? `How promising is ${name}?` : `What should happen next for ${triggerLabel.toLowerCase()}?`,
        context: [name ? `Record: {{event.entityType}} {{event.entityId}}` : "", research ? `Research brief: {{steps.${research.id}.output}}` : ""].filter(Boolean).join("\n"),
        options: entity === "ticket" ? ["Urgent", "Normal", "Low"] : ["Hot", "Warm", "Cold"],
      });
      continue;
    }
    if (/^(if|only if|only when|but only)\b/.test(c)) {
      const score = has("score");
      const opt = score && score.type === "action" && score.action.kind === "ai_decision" ? score.action.options.find((o) => c.includes(o.toLowerCase())) : undefined;
      if (score && opt) {
        push(clause, { id: id("only_if"), type: "condition", match: "all", conditions: [{ field: `steps.${score.id}.choice`, op: "eq", value: opt }] });
        continue;
      }
      unmatched.push(clause);
      continue;
    }
    if (/^(assign|route|give (it|them|this) to|hand (it|them) to)/.test(c)) {
      const pool = entity ? ASSIGN_POOL[entity] : undefined;
      if (!pool) {
        unmatched.push(clause);
        continue;
      }
      if (/\bto me\b/.test(c)) {
        action(clause, "assign", { kind: "assign_user", entity: pool.entity, recordId: "{{event.entityId}}", userId: opts.meId });
      } else {
        action(clause, "assign", {
          kind: "assign_round_robin",
          entity: pool.entity,
          recordId: "{{event.entityId}}",
          pool: pool.entity === "lead" ? "crm_rules" : "permission",
          userIds: [],
          ...(pool.entity === "lead" ? { fallbackPermission: pool.permission } : { permission: pool.permission }),
        });
      }
      continue;
    }
    if (/^(move|mark|set)\b/.test(c) && entity === "lead") {
      const stage = LEAD_STAGES.find((st) => c.includes(st));
      if (stage) {
        action(clause, "stage", { kind: "update_lead", leadId: "{{event.entityId}}", stage: stage.toUpperCase() as Uppercase<typeof stage> });
        continue;
      }
    }
    if (/\b(approv|sign[- ]?off|ask me first|check with me)/.test(c)) {
      action(clause, "approval", { kind: "request_approval", title: `Approve: ${subject}`.slice(0, 300), approverMode: "users", approverIds: [opts.meId], escalateToIds: [] });
      continue;
    }
    if (/\bslack\b/.test(c)) {
      const channel = /#([a-z0-9_-]{1,80})/.exec(c)?.[1] ?? "general";
      action(clause, "slack", { kind: "send_slack", channel, text: labelled, ifNotConnected: "fail" });
      continue;
    }
    if (/\b(e-?mail|welcome|thank)/.test(c) && !/\bnotif/.test(c)) {
      const toMe = /\b(email|e-mail) me\b|\bto me\b/.test(c);
      if (!toMe && !has("approval")) {
        // External sends always wait for a person's approval in rule-built workflows.
        push(`${clause} (approval first)`, {
          id: id("approve_email"),
          type: "action",
          action: { kind: "request_approval", title: `Send the email for ${subject}?`.slice(0, 300), approverMode: "users", approverIds: [opts.meId], escalateToIds: [] },
        });
      }
      if (toMe) {
        action(clause, "notify", { kind: "notify", recipients: "owner", userIds: [], title: labelled.slice(0, 300), href: href ?? "" });
      } else {
        action(clause, "email", {
          kind: "send_email",
          to: "{{event.data.email}}",
          subject: /\bwelcome/.test(c) ? "Welcome" : /\bthank/.test(c) ? "Thank you" : `Following up`,
          body: /\bwelcome/.test(c) ? `Hi ${name},\n\nWelcome! We're glad to have you.` : /\bthank/.test(c) ? `Hi ${name},\n\nThank you — we appreciate it.` : `Hi ${name},\n\nThanks for getting in touch. We'll be in touch shortly.`,
        });
      }
      continue;
    }
    if (/\b(notif|alert|tell|let .* know|ping|message me|inform)/.test(c)) {
      const score = has("score");
      const title = `${labelled}${score ? ` (${score.id.startsWith("score") ? "score" : "decision"}: {{steps.${score.id}.choice}})` : ""}`.slice(0, 300);
      const owner = /\b(owner|assignee|rep|them|whoever)\b/.test(c) && assignee();
      if (owner) action(clause, "notify", { kind: "notify", recipients: "field", userIds: [], userField: owner, title, href: href ?? "" });
      else if (/\b(team|everyone|sales)\b/.test(c) && entity && ASSIGN_POOL[entity]) action(clause, "notify", { kind: "notify", recipients: "permission", userIds: [], permission: ASSIGN_POOL[entity]!.permission, title, href: href ?? "" });
      else action(clause, "notify", { kind: "notify", recipients: "owner", userIds: [], title, href: href ?? "" });
      continue;
    }
    if (/\b(follow[- ]?up|remind|to-?do|\btask\b)/.test(c) && /^(create|add|make|remind|follow|set|schedule)/.test(c)) {
      action(clause, "task", { kind: "create_task", title: (name ? `Follow up: ${name}` : `Follow up: ${triggerLabel.toLowerCase()}`).slice(0, 300), priority: "MEDIUM", dueInDays: days ? Number(days) : 1, ...(assignee() ? { assigneeId: assignee() } : {}) });
      continue;
    }
    if (/\b(meeting|call|demo)\b/.test(c) && /^(schedule|book|set up|create|invite|arrange)/.test(c)) {
      action(clause, "meeting", { kind: "create_meeting", title: (name ? `Call: ${name}` : triggerLabel).slice(0, 200), startInHours: days ? Number(days) * 24 : 24, durationMinutes: 30, attendeeIds: [opts.meId], ...(assignee() ? { extraAttendeeIds: assignee() } : {}) });
      continue;
    }
    if (/^(create|open|start) (a |an )?deal/.test(c)) {
      action(clause, "deal", { kind: "create_deal", name: name || "New deal", ...(entity === "contact" ? { contactId: "{{event.entityId}}" } : {}) });
      continue;
    }
    if (/^(create|start|open|set up) (a |an )?project/.test(c)) {
      action(clause, "project", { kind: "create_project", name: name || "New project", template: "", memberIds: [opts.meId], startInDays: 0 });
      continue;
    }
    if (/\bonboard/.test(c) && entity === "employee") {
      action(clause, "onboarding", { kind: "start_onboarding", employeeId: "{{event.entityId}}", checklist: "ONBOARDING" });
      continue;
    }
    if (/^(summari[sz]e|draft|write|prepare)/.test(c)) {
      action(clause, "write", { kind: "generate_ai_content", profile: entity === "ticket" ? "support_agent" : entity === "lead" || entity === "deal" ? "sdr" : "chief_of_staff", title: clause.slice(0, 200), instructions: `${clause} — for ${subject}${name ? " (record {{event.entityId}})" : ""}. Use the company's records and knowledge. This is a draft for a person to review; do not send or publish anything.`, wait: true });
      continue;
    }
    unmatched.push(clause);
  }

  const shortSteps = notes.filter((n) => n.target && n.target !== "trigger").map((n) => n.target!.replace(/_\d+$/, "").replace(/_/g, " "));
  const nameText = `${triggerLabel}${shortSteps.length ? ` → ${[...new Set(shortSteps)].slice(0, 4).join(", ")}` : ""}`.slice(0, 160);
  return { name: nameText, definition: { trigger, variables: [], steps }, notes, unmatched };
}
