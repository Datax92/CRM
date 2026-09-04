"use client";

/**
 * Shared Employee Directory chrome, built to `Employee Directory.dc.html` and
 * `Employee Directory Mobile.dc.html`.
 *
 * Both files are drawn in **Manrope** on a `#eef4f3` ground with a
 * `letter-spacing:-0.01em` default — a different type system from the leads
 * screens (Poppins) and the dashboard (Plus Jakarta Sans). Every value in `E`
 * is the design's own; nothing is sampled from a picture.
 *
 * Inline styles rather than Tailwind, for the reason recorded in CLAUDE.md: an
 * arbitrary value the content scanner never saw emits no rule at all, and the
 * element then renders with no background.
 *
 * `buildDirectoryAnalytics` lives here because the web modal and the phone
 * overlay both draw the same four analytics panels. Deriving it twice would let
 * a win rate on one surface disagree with the other.
 */

import type { CSSProperties, ReactNode } from "react";
import type { Lead } from "@/hooks/useLeads";
import type { DealRecord } from "@/hooks/useFinancials";
import type { EmployeeMetrics } from "@/lib/metrics";
import { DEFAULT_KPI_TARGETS } from "@/lib/kpi";
import {
  matchesLeadFilter,
  ACTIVITY_FILTER_HINTS,
  LEAD_FILTER_LABELS,
  isActivityFilter,
  type LeadFilterKey,
} from "@/lib/leadBuckets";
import { resolveRange, withinRange, type RangeKey } from "@/lib/dates";

export { LEAD_FILTER_LABELS, ACTIVITY_FILTER_HINTS, isActivityFilter };
export type { LeadFilterKey, RangeKey };

export const E = {
  /* ground */
  page: "#eef4f3",
  surface: "#ffffff",
  border: "#e2ecea",
  softBorder: "#eef4f3",
  rowBorder: "#f2f7f6",
  field: "#f7fbfa",
  tint: "#f2f8f7",

  /* ink */
  ink: "#1b2827",
  inkMobile: "#141f1e",
  body: "#3c4d4b",
  muted: "#5b6d6b",
  label: "#8fa2a0",
  faint: "#9aacaa",
  hair: "#c3d5d3",

  /* teal */
  deep: "#1f5c58",
  teal: "#3f8f8a",
  tealInk: "#2f7d78",
  light: "#4fa39c",
  tealTint: "#e8f5f3",

  /* state */
  red: "#c0574a",
  redInk: "#b4524a",
  redBg: "#fdeeec",
  amber: "#c99a2e",
  amberInk: "#a5762a",
  amberBg: "#fdf5e6",
  blue: "#3f7ea3",
  blueBg: "#eef6fb",

  /** The hero and modal header gradient, identical in both design files. */
  gradient: "linear-gradient(115deg,#1f5c58 0%,#3f8f8a 62%,#4fa39c 100%)",
  gradientMobile: "linear-gradient(115deg,#1f5c58 0%,#3f8f8a 68%,#4fa39c 100%)",

  font: "var(--font-directory), Manrope, system-ui, sans-serif",
  tracking: "-0.01em",
} as const;

/** Lead status → the accent both files key their avatars and pills to. */
export const LEAD_ACCENT: Record<string, string> = {
  CLOSED_WON: "#2f7d78",
  CLOSED_LOST: "#c0574a",
  NOT_INTERESTED: "#c0574a",
  INTERESTED: "#3f7ea3",
  NEGOTIATION: "#3f7ea3",
  ASSIGNED: "#c99a2e",
};

export function leadAccent(status: string): string {
  return LEAD_ACCENT[status] ?? "#7e918f";
}

/** `dash` from both design files. */
export function ringDash(percent: number, radius: number): string {
  const c = 2 * Math.PI * radius;
  return `${Math.max(0, Math.min(1, percent / 100)) * c} ${c}`;
}

/**
 * The concentric hairline circles the designs layer over every gradient.
 *
 * The three banners carry **different** circles, not one set scaled — the
 * radii are not a fixed fraction of the viewBox, so each is transcribed from
 * its own design file rather than derived. A generalised formula rendered the
 * phone header's rings about 28% too large.
 */
const RING_SETS = {
  /** `Employee Directory.dc.html` — the page hero. */
  hero: {
    viewBox: "0 0 400 200",
    opacity: 0.18,
    circles: [
      [352, 26, 86],
      [352, 26, 130],
      [300, 176, 60],
    ],
  },
  /** `Employee Directory.dc.html` — the profile modal header. */
  modal: {
    viewBox: "0 0 400 140",
    opacity: 0.16,
    circles: [
      [356, 18, 72],
      [356, 18, 112],
      [292, 132, 52],
    ],
  },
  /** `Employee Directory Mobile.dc.html` — both phone headers. */
  phone: {
    viewBox: "0 0 390 220",
    opacity: 0.16,
    circles: [
      [344, 24, 74],
      [344, 24, 116],
      [290, 206, 56],
    ],
  },
} as const;

export type RingSet = keyof typeof RING_SETS;

export function HeroRings({ set = "hero" }: { set?: RingSet }) {
  const { viewBox, opacity, circles } = RING_SETS[set];
  return (
    <svg
      viewBox={viewBox}
      // `none` exactly as the design files do, so the rings stretch with the
      // banner rather than staying circular.
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity }}
      aria-hidden
    >
      {circles.map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}-${r}`} cx={cx} cy={cy} r={r} fill="none" stroke="#fff" strokeWidth="1.2" />
      ))}
    </svg>
  );
}

export function Card({
  children,
  style,
  radius = 16,
  onClick,
  onKeyDown,
  role,
  tabIndex,
}: {
  children: ReactNode;
  style?: CSSProperties;
  radius?: number;
  /** Present when the whole card is the target — a dossier lead row, say. */
  onClick?: () => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  role?: string;
  tabIndex?: number;
}) {
  return (
    <div
      style={{
        background: E.surface,
        border: `1px solid ${E.border}`,
        borderRadius: radius,
        minWidth: 0,
        ...style,
      }}
    
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={role}
      tabIndex={tabIndex}
    >
      {children}
    </div>
  );
}

/** A progress track. Targets, outcomes and the mobile metrics all use it. */
export function Bar({
  percent,
  fill,
  height = 9,
  track = E.page,
  minWidth = 2,
}: {
  percent: number;
  fill: string;
  height?: number;
  track?: string;
  minWidth?: number;
}) {
  return (
    <div style={{ height, borderRadius: 999, background: track, overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          borderRadius: 999,
          width: `${Math.max(minWidth, Math.min(100, percent))}%`,
          background: fill,
          transition: "width 420ms cubic-bezier(0.22,0.61,0.36,1)",
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dossier filters                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The period and lead cuts applied inside an employee's profile.
 *
 * The lead cut reuses `matchesLeadFilter` rather than restating what "active"
 * or "hot" means — a second definition here would drift from the one the leads
 * workspace enforces, and the two screens would disagree about the same lead.
 */
export const DOSSIER_PERIODS: Array<{ key: RangeKey; label: string }> = [
  { key: "TODAY", label: "Today" },
  { key: "WEEK", label: "This week" },
  { key: "MONTH", label: "This month" },
  { key: "ALL", label: "All time" },
];

/**
 * ALL first, then the workflow buckets, then the four pipeline stages, then
 * what this person has actually **done** to their leads.
 *
 * The activity cuts come last because they answer a different question from
 * the ones before them: those say where a lead stands, these say how far the
 * employee has got with it. Putting "Connected" among the stages would suggest
 * a lead moves *into* it the way it moves into P2.
 */
export const DOSSIER_LEAD_CUTS: LeadFilterKey[] = [
  "ALL",
  "ACTIVE",
  "CLOSED",
  "COLD",
  "P3",
  "P2",
  "P1",
  "REMARKED",
  "FOLLOWED_UP",
  "CONNECTED",
];

export interface DossierFilters {
  period: RangeKey;
  cut: LeadFilterKey;
}

export const DEFAULT_DOSSIER_FILTERS: DossierFilters = { period: "ALL", cut: "ALL" };

/**
 * Applies the dossier filters to one employee's leads.
 *
 * The period is measured on `createdAt`, matching the leads workspace and
 * `buildEmployeeMetrics` — filtering on last touch instead would make a lead
 * move between periods every time somebody rang it.
 */
export function applyLeadFilters(leads: Lead[], filters: DossierFilters): Lead[] {
  const range = resolveRange(filters.period);
  return leads.filter(
    (lead) => withinRange(lead.createdAt, range) && matchesLeadFilter(lead, filters.cut, undefined, "admin")
  );
}

/** Deals in the period, by settlement date — the day the money was recorded. */
export function applyDealPeriod(deals: DealRecord[], period: RangeKey): DealRecord[] {
  const range = resolveRange(period);
  return deals.filter((deal) => withinRange(deal.dealDate ?? deal.enteredAt, range));
}

/** Activity in the period. Entries with no timestamp are kept — see `buildActivity`. */
export function applyActivityPeriod(entries: ActivityEntry[], period: RangeKey): ActivityEntry[] {
  const range = resolveRange(period);
  return entries.filter((entry) => (entry.at ? withinRange(entry.at, range) : true));
}

/* -------------------------------------------------------------------------- */
/* Analytics                                                                   */
/* -------------------------------------------------------------------------- */

export interface DirectoryAnalytics {
  /** Chart ceiling, rounded up to an even number and never below 4. */
  max: number;
  months: Array<{ label: string; leads: number; won: number }>;
  kpis: Array<{
    label: string;
    value: string;
    detail: string;
    note: string;
    pct: number;
    color: string;
  }>;
  targets: Array<{ label: string; value: string; pct: number; note: string; color: string; fill: string }>;
  outcomes: Array<{ label: string; count: number; color: string; pct: number }>;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Karachi month index for a Firestore timestamp or Date. */
function monthOf(value: { toDate?: () => Date } | Date | null | undefined): { y: number; m: number } | null {
  const date = value instanceof Date ? value : typeof value?.toDate === "function" ? value.toDate() : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
  }).format(date);
  const [y, m] = parts.split("-").map(Number);
  return { y, m };
}

/** `count` month buckets ending on the current month, oldest first. */
function monthWindow(count: number, now: { y: number; m: number }) {
  const window: Array<{ y: number; m: number; label: string }> = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const raw = now.m - 1 - back;
    const y = now.y + Math.floor(raw / 12);
    const m = ((raw % 12) + 12) % 12;
    window.push({ y, m: m + 1, label: MONTH_LABELS[m] });
  }
  return window;
}

/* -------------------------------------------------------------------------- */
/* Headline stat cards                                                         */
/* -------------------------------------------------------------------------- */

export interface DirectoryStat {
  label: string;
  value: string;
  note: string;
  /** Signed change over the previous month. `null` when there is nothing to compare. */
  delta: string | null;
  up: boolean;
  accent: string;
  /** Seven monthly readings, oldest first, for the sparkline. */
  spark: number[];
  /** The card's own icon path, from the design file. */
  icon: string;
}

export const STAT_ICONS = [
  "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11ZM2.5 20c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5M17 5a3.2 3.2 0 0 1 0 6.4",
  "M4 6h16M4 12h10M4 18h13",
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  "M3 17l6-6 4 3 8-8M15 6h6v6",
] as const;

const SPARK_MONTHS = 7;

/**
 * The four headline cards.
 *
 * The design file's sparklines and delta pills are hard-coded sample arrays.
 * These are the real thing: seven monthly readings ending on the current month,
 * and a delta that is this month measured against last. A decorative trend line
 * on a real dashboard is worse than none — it invites a decision from a shape
 * that means nothing.
 */
export function buildDirectoryStats(
  metrics: EmployeeMetrics[],
  leads: Lead[],
  deals: DealRecord[]
): DirectoryStat[] {
  const now = monthOf(new Date())!;
  const window = monthWindow(SPARK_MONTHS, now);
  const slot = new Map(window.map((w, i) => [`${w.y}-${w.m}`, i]));
  const zeros = () => new Array(SPARK_MONTHS).fill(0) as number[];

  // Headcount at the end of each month: everyone who had joined by then.
  const headcount = window.map(
    (w) =>
      metrics.filter((employee) => {
        const at = monthOf(employee.joinedAt ?? employee.createdAt);
        // Someone with no start date on record is treated as always present,
        // otherwise the line would climb as soon as anyone fills the field in.
        if (!at) return true;
        return at.y < w.y || (at.y === w.y && at.m <= w.m);
      }).length
  );

  const leadsPerMonth = zeros();
  const wonPerMonth = zeros();
  for (const lead of leads) {
    const at = monthOf(lead.createdAt);
    const index = at ? slot.get(`${at.y}-${at.m}`) : undefined;
    if (index === undefined) continue;
    leadsPerMonth[index] += 1;
    if (lead.status === "CLOSED_WON") wonPerMonth[index] += 1;
  }

  const profitPerMonth = zeros();
  for (const deal of deals) {
    const at = monthOf(deal.dealDate ?? deal.enteredAt);
    const index = at ? slot.get(`${at.y}-${at.m}`) : undefined;
    if (index !== undefined) profitPerMonth[index] += Number(deal.profit) || 0;
  }

  const winRatePerMonth = leadsPerMonth.map((count, i) =>
    count > 0 ? Math.round((wonPerMonth[i] / count) * 100) : 0
  );

  const last = SPARK_MONTHS - 1;
  const handled = metrics.reduce((sum, e) => sum + e.assigned, 0);
  const won = metrics.reduce((sum, e) => sum + e.closedWon, 0);
  const profit = metrics.reduce((sum, e) => sum + e.profit, 0);
  const active = metrics.filter((e) => e.status === "ACTIVE").length;
  const winRate = handled > 0 ? Math.round((won / handled) * 100) : 0;

  const joinedThisMonth = headcount[last] - headcount[last - 1];
  const leadDelta = leadsPerMonth[last] - leadsPerMonth[last - 1];
  const winDelta = winRatePerMonth[last] - winRatePerMonth[last - 1];

  const signed = (n: number, suffix = "") => `${n >= 0 ? "+" : "−"}${Math.abs(n)}${suffix}`;

  return [
    {
      label: "Team Members",
      value: String(metrics.length),
      note:
        active === metrics.length
          ? metrics.length === 1
            ? "active"
            : "all active"
          : `${active} active · ${metrics.length - active} paused`,
      delta: joinedThisMonth !== 0 ? signed(joinedThisMonth) : null,
      up: joinedThisMonth >= 0,
      accent: E.teal,
      spark: headcount,
      icon: STAT_ICONS[0],
    },
    {
      label: "Leads Handled",
      value: String(handled),
      note: "lifetime",
      delta: leadDelta !== 0 ? signed(leadDelta) : null,
      up: leadDelta >= 0,
      accent: E.teal,
      spark: leadsPerMonth,
      icon: STAT_ICONS[1],
    },
    {
      label: "Win Rate",
      value: `${winRate}%`,
      note: `${won} won of ${handled}`,
      delta: winDelta !== 0 ? signed(winDelta, "pp") : null,
      up: winDelta >= 0,
      accent: E.light,
      spark: winRatePerMonth,
      icon: STAT_ICONS[2],
    },
    {
      label: "Profit Generated",
      value: `Rs ${Math.round(profit).toLocaleString()}`,
      note: "all time",
      delta:
        profitPerMonth[last] !== 0
          ? `${profitPerMonth[last] >= 0 ? "+" : ""}${compactRupees(profitPerMonth[last])}`
          : null,
      up: profitPerMonth[last] >= 0,
      accent: E.tealInk,
      spark: profitPerMonth,
      icon: STAT_ICONS[3],
    },
  ];
}

/**
 * `Rs 4.9M`, `Rs 850k` — for the places a full figure does not fit.
 *
 * Only used where the exact number is available elsewhere on the same screen.
 * A ledger always shows the precise amount.
 */
export function compactRupees(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "\u2212" : "";
  if (abs >= 1_000_000) return `${sign}Rs ${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${sign}Rs ${Math.round(abs / 1_000)}k`;
  return `${sign}Rs ${Math.round(abs)}`;
}

/**
 * Everything the Analytics tab draws, from data the directory already holds.
 *
 * No new listener: leads and deals are already loaded for the roster table, so
 * this is a pass over arrays in memory rather than a per-employee read.
 *
 * The design's six-month window is kept — it ends on the current month, so the
 * chart always shows the run-up to now rather than a fixed calendar slice.
 */
export function buildDirectoryAnalytics(
  employee: EmployeeMetrics,
  leads: Lead[],
  deals: DealRecord[]
): DirectoryAnalytics {
  const now = monthOf(new Date())!;
  const own = leads.filter((lead) => lead.assignedUserId === employee.uid);
  const ownDeals = deals.filter((deal) => deal.userId === employee.uid);

  // Six buckets ending on this month, oldest first.
  const window: Array<{ y: number; m: number; label: string; leads: number; won: number }> = [];
  for (let back = 5; back >= 0; back -= 1) {
    const raw = now.m - 1 - back;
    const y = now.y + Math.floor(raw / 12);
    const m = ((raw % 12) + 12) % 12;
    window.push({ y, m: m + 1, label: MONTH_LABELS[m], leads: 0, won: 0 });
  }
  const slot = new Map(window.map((w, i) => [`${w.y}-${w.m}`, i]));

  for (const lead of own) {
    const at = monthOf(lead.createdAt);
    const index = at ? slot.get(`${at.y}-${at.m}`) : undefined;
    if (index !== undefined) window[index].leads += 1;
  }
  for (const deal of ownDeals) {
    const at = monthOf(deal.dealDate ?? deal.enteredAt);
    const index = at ? slot.get(`${at.y}-${at.m}`) : undefined;
    if (index !== undefined) window[index].won += 1;
  }

  const peak = Math.max(1, ...window.map((w) => Math.max(w.leads, w.won)));
  // The design's own rule: never below 4, and rounded up to an even number so
  // the midpoint label is a whole one.
  const max = peak < 4 ? 4 : Math.ceil(peak / 2) * 2;

  const winPct = employee.assigned > 0 ? Math.round((employee.closedWon / employee.assigned) * 100) : 0;

  // Offered, then taken away when the window lapsed — so the denominator is
  // everything they were ever offered, not just what they kept.
  const offered = employee.accepted + employee.missed;
  const acceptancePct = offered > 0 ? Math.round((employee.accepted / offered) * 100) : 100;

  const monthlyTarget = employee.targets?.revenue ?? DEFAULT_KPI_TARGETS.revenue;
  const monthsElapsed = now.m;

  const thisMonthRevenue = ownDeals
    .filter((deal) => {
      const at = monthOf(deal.dealDate ?? deal.enteredAt);
      return at?.y === now.y && at?.m === now.m;
    })
    .reduce((total, deal) => total + (Number(deal.amountReceived) || 0), 0);

  const thisYearRevenue = ownDeals
    .filter((deal) => monthOf(deal.dealDate ?? deal.enteredAt)?.y === now.y)
    .reduce((total, deal) => total + (Number(deal.amountReceived) || 0), 0);

  const mtdPct = monthlyTarget > 0 ? Math.round((thisMonthRevenue / monthlyTarget) * 100) : 0;
  const ytdPct = monthlyTarget > 0 ? Math.round((thisYearRevenue / (monthlyTarget * monthsElapsed)) * 100) : 0;
  const targetPct = Math.min(100, mtdPct);

  const inProgress = Math.max(0, employee.assigned - employee.closedWon - employee.lost);
  const outcomeCounts = [
    { label: "Closed Won", count: employee.closedWon, color: "#2f7d78" },
    { label: "Closed Lost", count: employee.lost, color: "#c0574a" },
    { label: "In Progress", count: inProgress, color: "#3f7ea3" },
    { label: "Missed", count: employee.missed, color: "#c99a2e" },
  ];
  const outcomeMax = Math.max(1, ...outcomeCounts.map((o) => o.count));

  // Compact, because "Rs 4,850,000 of Rs 3,000,000" ellipsises inside the
  // design's 200px KPI card and turns into a different, wrong number.
  const money = compactRupees;

  return {
    max,
    months: window.map(({ label, leads: l, won }) => ({ label, leads: l, won })),
    kpis: [
      {
        label: "Win Rate",
        value: `${winPct}%`,
        detail: `${employee.closedWon} won of ${employee.assigned}`,
        note: "lifetime conversion",
        pct: winPct,
        color: E.teal,
      },
      {
        label: "Acceptance",
        value: `${acceptancePct}%`,
        detail: "Leads accepted on time",
        note: `${employee.missed} missed`,
        pct: acceptancePct,
        color: E.light,
      },
      {
        label: "Target",
        value: `${targetPct}%`,
        detail: `${money(thisMonthRevenue)} of ${money(monthlyTarget)}`,
        note: "monthly revenue target",
        pct: targetPct,
        // The design's own threshold: teal at 60% and above, amber below.
        color: targetPct >= 60 ? E.tealInk : E.amber,
      },
    ],
    targets: [
      { label: "MTD", pct: mtdPct, note: "against this month's target" },
      { label: "YTD", pct: ytdPct, note: "against the year so far" },
    ].map((t) => ({
      ...t,
      value: `${t.pct}%`,
      color: t.pct >= 60 ? E.tealInk : E.red,
      fill:
        t.pct >= 60
          ? "linear-gradient(90deg,#3f8f8a,#63b3ad)"
          : "linear-gradient(90deg,#d8735f,#c0574a)",
    })),
    outcomes: outcomeCounts.map((o) => ({
      ...o,
      pct: Math.round((o.count / outcomeMax) * 100),
    })),
  };
}

/**
 * Activity, reconstructed from each lead's own counters and timestamps.
 *
 * A true per-action feed would mean reading every lead's `events`
 * subcollection — one read per lead, on a panel opened from a table row. The
 * shape below is what those documents would produce anyway.
 */
export interface ActivityEntry {
  action: string;
  detail: string;
  at: Date | null;
  icon: string;
}

const ICON_DEAL = "M20 6 9 17l-5-5";
const ICON_LOST = "M6 6l12 12M18 6 6 18";
const ICON_JOINED = "M12 11a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM5 20c0-3.3 3.1-5.2 7-5.2s7 1.9 7 5.2";
const ICON_CLOCK = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3.5 2";

export function buildActivity(
  employee: EmployeeMetrics,
  leads: Lead[],
  deals: DealRecord[]
): ActivityEntry[] {
  const toDate = (v: { toDate?: () => Date } | undefined | null) =>
    typeof v?.toDate === "function" ? v.toDate() : null;

  const entries: ActivityEntry[] = [];

  for (const deal of deals.filter((d) => d.userId === employee.uid)) {
    entries.push({
      action: `Closed deal with ${deal.customer?.name ?? "a client"}`,
      detail: `Rs ${Math.round(Number(deal.profit) || 0).toLocaleString()} profit settled`,
      at: toDate(deal.dealDate ?? deal.enteredAt),
      icon: ICON_DEAL,
    });
  }

  for (const lead of leads.filter((l) => l.assignedUserId === employee.uid)) {
    if (lead.status === "CLOSED_LOST" || lead.status === "NOT_INTERESTED") {
      entries.push({
        action: `Lost ${lead.name}`,
        detail: lead.status === "NOT_INTERESTED" ? "Marked not interested" : "Closed lost",
        at: toDate(lead.closedAt ?? lead.lastActivityAt),
        icon: ICON_LOST,
      });
    } else if (lead.status === "INTERESTED" || lead.status === "NEGOTIATION") {
      entries.push({
        action: `Moved ${lead.name} to ${lead.status === "NEGOTIATION" ? "Negotiation" : "Interested"}`,
        detail: `${lead.followUpCount ?? 0} follow-ups logged`,
        at: toDate(lead.lastActivityAt ?? lead.acceptedAt),
        icon: ICON_CLOCK,
      });
    }
  }

  entries.push({
    action: "Account created",
    detail: `${employee.jobTitle}, priority ${employee.priority}`,
    at: toDate(employee.joinedAt ?? employee.createdAt),
    icon: ICON_JOINED,
  });

  // Newest first; anything without a timestamp sinks rather than jumping to the
  // top on a falsy comparison.
  return entries.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}
