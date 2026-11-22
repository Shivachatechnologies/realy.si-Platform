/**
 * Control Center → Growth (stream D): sign-ups, sources, activation funnel, weekly retention cohorts, trial
 * conversion, subscription churn, checkout conversion, waitlist and promotion performance — only from data the
 * platform already records. Marketing attribution (UTM, referrer, campaign) is not captured at sign-up, so it is
 * reported as not tracked rather than guessed.
 */
import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { requireAnyPlatform } from "./access";

const DAY = 86_400_000;
const utcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const growthInput = z.object({ days: z.coerce.number().int().refine((d) => [30, 90, 180, 365].includes(d)).default(90).catch(90) });

type N = bigint | number | null;
const num = (v: N | undefined) => Number(v ?? 0);

/** Monday 00:00 UTC of the week containing `d`. */
export const weekStart = (d: Date) => {
  const day = utcDay(d);
  const dow = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - dow * DAY);
};

const COHORT_WEEKS = 12;

export async function growthOverview(ctx: RequestContext, raw: { days?: unknown } = {}) {
  await requireAnyPlatform(ctx, ["platform.users.read", "platform.subscriptions.read", "pricing.read"]);
  const { days } = growthInput.parse(raw);
  const from = new Date(utcDay().getTime() - (days - 1) * DAY);
  const cohortFrom = new Date(weekStart(new Date()).getTime() - (COHORT_WEEKS - 1) * 7 * DAY);
  const [signupDays, methods, countries, funnel, cohorts, trials, churn, checkouts, waitlist, waitlistSources, coupons] = await Promise.all([
    db().$queryRaw<{ day: Date; n: N }[]>(Prisma.sql`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM users WHERE created_at >= ${from} GROUP BY 1`),
    // Sign-up method from the registration audit entry (password, or the OAuth provider).
    db().$queryRaw<{ method: string | null; n: N }[]>(Prisma.sql`
      SELECT COALESCE(new_value->>'via', 'password') AS method, COUNT(*)::bigint AS n FROM audit_logs
      WHERE action = 'user.registered' AND created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC`),
    db().$queryRaw<{ country: string | null; n: N }[]>(Prisma.sql`SELECT country_code AS country, COUNT(*)::bigint AS n FROM users WHERE created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`),
    db().$queryRaw<{ signed_up: N; verified: N; in_org: N; with_company: N; trial: N; paid: N; activated_7d: N }[]>(Prisma.sql`
      WITH u AS (SELECT id, email_verified_at, created_at FROM users WHERE created_at >= ${from}),
           m AS (SELECT DISTINCT ON (m.user_id) m.user_id, m.organization_id, m.created_at FROM memberships m JOIN u ON u.id = m.user_id ORDER BY m.user_id, m.created_at)
      SELECT
        (SELECT COUNT(*) FROM u)::bigint AS signed_up,
        (SELECT COUNT(*) FROM u WHERE email_verified_at IS NOT NULL)::bigint AS verified,
        (SELECT COUNT(*) FROM m)::bigint AS in_org,
        (SELECT COUNT(*) FROM m WHERE EXISTS (SELECT 1 FROM companies c WHERE c.organization_id = m.organization_id AND c.deleted_at IS NULL))::bigint AS with_company,
        (SELECT COUNT(*) FROM m WHERE EXISTS (SELECT 1 FROM entitlement_trials t WHERE t.organization_id = m.organization_id))::bigint AS trial,
        (SELECT COUNT(*) FROM m WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = m.organization_id AND (s.status IN ('ACTIVE','PAST_DUE') OR s.last_payment_succeeded_at IS NOT NULL)))::bigint AS paid,
        (SELECT COUNT(*) FROM m JOIN u ON u.id = m.user_id WHERE EXISTS (SELECT 1 FROM companies c WHERE c.organization_id = m.organization_id AND c.created_at <= u.created_at + interval '7 days'))::bigint AS activated_7d`),
    // Weekly cohorts: a user counts as retained in week k when a session was started or last used in that week.
    db().$queryRaw<{ cohort: Date; size: N; week: number; active: N }[]>(Prisma.sql`
      WITH u AS (SELECT id, date_trunc('week', created_at AT TIME ZONE 'UTC') AS cohort FROM users WHERE created_at >= ${cohortFrom}),
           act AS (
             SELECT user_id, date_trunc('week', created_at AT TIME ZONE 'UTC') AS wk FROM sessions WHERE created_at >= ${cohortFrom}
             UNION SELECT user_id, date_trunc('week', last_seen_at AT TIME ZONE 'UTC') FROM sessions WHERE last_seen_at >= ${cohortFrom}),
           sizes AS (SELECT cohort, COUNT(*)::bigint AS size FROM u GROUP BY 1)
      SELECT s.cohort, s.size, ((EXTRACT(EPOCH FROM (a.wk - u.cohort)) / 604800)::int) AS week, COUNT(DISTINCT u.id)::bigint AS active
      FROM u JOIN sizes s ON s.cohort = u.cohort JOIN act a ON a.user_id = u.id AND a.wk >= u.cohort
      GROUP BY 1, 2, 3 ORDER BY 1, 3`),
    db().$queryRaw<{ started: N; ended: N; converted: N }[]>(Prisma.sql`
      SELECT (SELECT COUNT(*) FROM entitlement_trials WHERE started_at >= ${from})::bigint AS started,
             (SELECT COUNT(*) FROM entitlement_trials WHERE ends_at >= ${from} AND ends_at <= now())::bigint AS ended,
             (SELECT COUNT(*) FROM entitlement_trials t WHERE t.ends_at >= ${from} AND t.ends_at <= now()
                AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = t.organization_id AND s.created_at >= t.started_at
                            AND s.status NOT IN ('INCOMPLETE','INCOMPLETE_EXPIRED')))::bigint AS converted`),
    db().$queryRaw<{ base: N; canceled: N }[]>(Prisma.sql`
      SELECT (SELECT COUNT(*) FROM subscriptions WHERE created_at < ${from} AND (canceled_at IS NULL OR canceled_at >= ${from}) AND status NOT IN ('INCOMPLETE','INCOMPLETE_EXPIRED'))::bigint AS base,
             (SELECT COUNT(*) FROM subscriptions WHERE canceled_at >= ${from})::bigint AS canceled`),
    db().checkoutSession.groupBy({ by: ["status"], where: { createdAt: { gte: from } }, _count: { _all: true } }),
    db().siteWaitlistEntry.groupBy({ by: ["status"], _count: { _all: true } }),
    db().$queryRaw<{ source: string | null; n: N }[]>(Prisma.sql`SELECT source, COUNT(*)::bigint AS n FROM site_waitlist_entries WHERE created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    db().$queryRaw<{ code: string; promotion: string; redemptions: number; max: number | null; started: N; completed: N }[]>(Prisma.sql`
      SELECT c.code, p.name AS promotion, c.redemptions, p.max_redemptions AS max,
             (SELECT COUNT(*) FROM checkout_sessions s WHERE s.coupon_code = c.code AND s.created_at >= ${from})::bigint AS started,
             (SELECT COUNT(*) FROM checkout_sessions s WHERE s.coupon_code = c.code AND s.status = 'COMPLETED' AND s.created_at >= ${from})::bigint AS completed
      FROM coupons c JOIN promotions p ON p.id = c.promotion_id ORDER BY c.redemptions DESC, c.created_at DESC LIMIT 20`),
  ]);
  const dayKeys = Array.from({ length: days }, (_, i) => new Date(from.getTime() + i * DAY).toISOString().slice(0, 10));
  const f = funnel[0];
  const cohortMap = new Map<string, { cohort: string; size: number; weeks: (number | null)[] }>();
  const thisWeek = weekStart(new Date()).getTime();
  for (const r of cohorts) {
    const key = r.cohort.toISOString().slice(0, 10);
    if (!cohortMap.has(key)) {
      const elapsed = Math.floor((thisWeek - r.cohort.getTime()) / (7 * DAY));
      // Weeks that have not happened yet are null, not 0.
      cohortMap.set(key, { cohort: key, size: num(r.size), weeks: Array.from({ length: COHORT_WEEKS }, (_, w) => (w <= elapsed ? 0 : null)) });
    }
    const c = cohortMap.get(key)!;
    if (r.week >= 0 && r.week < COHORT_WEEKS && c.weeks[r.week] !== null) c.weeks[r.week] = num(r.active);
  }
  const t = trials[0];
  const ch = churn[0];
  const checkoutBy = Object.fromEntries(checkouts.map((c) => [c.status, c._count._all])) as Record<string, number>;
  const checkoutTotal = Object.values(checkoutBy).reduce((a, b) => a + b, 0);
  return {
    days,
    signups: { days: dayKeys, values: dayKeys.map((d) => num(signupDays.find((r) => r.day.toISOString().slice(0, 10) === d)?.n)), total: signupDays.reduce((a, r) => a + num(r.n), 0) },
    methods: methods.map((m) => ({ method: m.method ?? "password", count: num(m.n) })),
    countries: countries.map((c) => ({ country: c.country, count: num(c.n) })),
    funnel: f
      ? [
          { step: "signedUp", count: num(f.signed_up) },
          { step: "verified", count: num(f.verified) },
          { step: "inOrg", count: num(f.in_org) },
          { step: "withCompany", count: num(f.with_company) },
          { step: "trial", count: num(f.trial) },
          { step: "paid", count: num(f.paid) },
        ]
      : [],
    activation7d: f && num(f.signed_up) ? num(f.activated_7d) / num(f.signed_up) : null,
    cohorts: [...cohortMap.values()],
    trials: { started: num(t?.started), ended: num(t?.ended), converted: num(t?.converted), rate: num(t?.ended) ? num(t?.converted) / num(t?.ended) : null },
    churn: { base: num(ch?.base), canceled: num(ch?.canceled), rate: num(ch?.base) ? num(ch?.canceled) / num(ch?.base) : null },
    checkout: { byStatus: checkoutBy, total: checkoutTotal, rate: checkoutTotal ? (checkoutBy.COMPLETED ?? 0) / checkoutTotal : null },
    waitlist: { byStatus: Object.fromEntries(waitlist.map((w) => [w.status, w._count._all])) as Record<string, number>, sources: waitlistSources.map((s) => ({ source: s.source, count: num(s.n) })) },
    coupons: coupons.map((c) => ({ code: c.code, promotion: c.promotion, redemptions: c.redemptions, max: c.max, checkoutsStarted: num(c.started), checkoutsCompleted: num(c.completed) })),
    attribution: { tracked: false as const },
  };
}
