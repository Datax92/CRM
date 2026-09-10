"use client";

/**
 * The expenses design language — one implementation, two screens.
 *
 * Transcribed from `Website redesign in teal CRM style (1)/Office Expenses
 * .dc.html` and `Office Expenses Mobile.dc.html`; **values are copied from the
 * files, never measured off a rendering**, and `scripts/` diffs them back
 * against the source.
 *
 * It lives here rather than inside `OfficeExpensesView` because Personal
 * Expenses is the same screen asking a different question — a claim instead of
 * an invoice, an employee instead of a payee — and the owner asked for the two
 * to look identical. Two copies of a hero, five stat cards, a filter grid and a
 * row would be four places for them to drift apart; this is one. What each
 * screen owns is its **data**: it builds `ExpenseRowModel`s and hands them over.
 */

import type { CSSProperties, ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Download } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

export const X = {
  ink: "#141f1e",
  body: "#3c4d4b",
  muted: "#5b6d6b",
  faint: "#6c7d7b",
  line: "#e2ecea",
  hair: "#f2f7f6",
  rowLine: "#f2f7f6",
  panelLine: "#eef4f3",
  well: "#f7fbfa",
  tint: "#f2f8f7",
  track: "#dceae8",
  teal: "#3f8f8a",
  deep: "#2f7d78",
  darkest: "#1f5c58",
  gradient: "linear-gradient(115deg,#1f5c58 0%,#3f8f8a 66%,#4fa39c 100%)",
} as const;

/** The design's own field: a `#f7fbfa` well with a 10px radius. */
export const designField: CSSProperties = {
  width: "100%",
  border: `1px solid ${X.line}`,
  background: X.well,
  borderRadius: 10,
  padding: "10px 12px",
  fontWeight: 600,
  color: "#22302f",
  outline: "none",
  fontFamily: "inherit",
};

export const designLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "1.1px",
  textTransform: "uppercase",
  color: X.faint,
};

export interface Tone {
  color: string;
  tint: string;
}

/**
 * The category palette.
 *
 * The design names four; both screens have **editable or longer** category
 * lists, so an unlisted one falls to `Office` rather than rendering with no
 * colour at all. Matching is case-insensitive — a category typed "marketing" is
 * the same spend as one typed "Marketing" — and the aliases map the personal
 * claim categories onto the same four colours, so a Fuel claim and a Transport
 * invoice do not arrive in two different blues.
 */
const CAT_META: Record<string, Tone & { d: string }> = {
  salaries: { color: "#2f7d78", tint: "#e8f5f3", d: "M12 11a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM5 20c0-3.3 3.1-5.2 7-5.2s7 1.9 7 5.2" },
  marketing: { color: "#3f7ea3", tint: "#eef6fb", d: "M4 16l5-5 4 3 7-8M15 6h6v6" },
  utilities: { color: "#a5762a", tint: "#fdf5e6", d: "M13 3 5 14h6l-1 7 8-11h-6z" },
  office: { color: "#6b6ea8", tint: "#eeeff8", d: "M3 21h18M5 21V7l7-4 7 4v14M9 11h2M13 11h2M9 15h2M13 15h2" },
};

/** Every other category this app offers, pointed at one of the four above. */
const CAT_ALIAS: Record<string, keyof typeof CAT_META> = {
  // Office expenses
  rent: "office", internet: "utilities", "office supplies": "office",
  equipment: "office", maintenance: "office", transport: "utilities",
  "software/subscriptions": "marketing", electricity: "utilities",
  water: "utilities", bills: "utilities", other: "office",
  // Personal claims
  travel: "utilities", fuel: "utilities", meals: "marketing",
  "client entertainment": "marketing", supplies: "office", phone: "utilities",
};

export function catMeta(category: string): Tone & { d: string } {
  const key = (category ?? "").trim().toLowerCase();
  return CAT_META[key] ?? CAT_META[CAT_ALIAS[key] ?? "office"];
}

/** The status palette. Three tones, and every other status maps onto one. */
export const TONE = {
  good: { color: "#2f7d78", tint: "#e8f5f3" },
  warn: { color: "#a5762a", tint: "#fdf5e6" },
  bad: { color: "#a8483c", tint: "#fdeeec" },
  quiet: { color: "#6c7d7b", tint: "#f2f7f6" },
} as const satisfies Record<string, Tone>;

/**
 * `short()` from the mobile design file — thousands, and nothing larger.
 *
 * Both of its branches collapse to the same expression (it rounds to `k` either
 * side of a lakh), which is transcribed as the one branch it is.
 */
export function shortRupees(n: number): string {
  return Math.abs(n) >= 1000 ? `Rs ${Math.round(n / 1000)}k` : `Rs ${n}`;
}

/* -------------------------------------------------------------------------- */
/* The hero                                                                    */
/* -------------------------------------------------------------------------- */

export interface HeroStat {
  label: string;
  value: number;
}

/**
 * The 115° gradient banner with the design's three rings.
 *
 * The desktop file draws a 50px glass tile and a 32px figure; the mobile file
 * the same gradient with a 40px tile and a 29px figure, so the two differ only
 * by those values and are one component.
 *
 * The mobile file also draws a 390×844 phone with a 9:41 status bar. That is
 * **not** reproduced — inside a real phone it would put a second status bar
 * under the real one, which is this project's standing rule.
 */
export function ExpenseHero({
  eyebrow, figure, caption, isMobile, tileIcon, actions, mobileAction, stats, children,
}: {
  eyebrow: string;
  figure: string;
  caption: string;
  isMobile: boolean;
  tileIcon: string;
  /** The desktop's pill row. */
  actions?: ReactNode;
  /** The phone's single 40px glass tile. */
  mobileAction?: ReactNode;
  /** The phone's three-up strip. Absent on the desktop, as the design has it. */
  stats?: HeroStat[];
  /** The period pill and anything it opens. */
  children?: ReactNode;
}) {
  return (
    <section
      style={{
        position: "relative", overflow: "hidden", borderRadius: 20,
        background: X.gradient, color: "#fff",
        padding: isMobile ? "18px 20px" : "22px 26px",
      }}
    >
      <svg viewBox="0 0 400 170" preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.16 }} aria-hidden>
        <circle cx="356" cy="20" r="78" fill="none" stroke="#fff" strokeWidth="1.2" />
        <circle cx="356" cy="20" r="120" fill="none" stroke="#fff" strokeWidth="1.2" />
        <circle cx="296" cy="162" r="54" fill="none" stroke="#fff" strokeWidth="1.2" />
      </svg>

      <div style={{ position: "relative", display: "flex", alignItems: isMobile ? "flex-start" : "flex-end", justifyContent: "space-between", gap: isMobile ? 14 : 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          {!isMobile && (
            <div style={{ width: 50, height: 50, borderRadius: 16, background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.42)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={tileIcon} />
              </svg>
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: isMobile ? "1.5px" : "1.6px", textTransform: "uppercase", opacity: 0.74 }}>{eyebrow}</div>
            <div style={{ fontSize: isMobile ? 29 : 32, fontWeight: 800, letterSpacing: isMobile ? "-1.1px" : "-1.2px", marginTop: isMobile ? 2 : 1, fontVariantNumeric: "tabular-nums" }}>{figure}</div>
            <div style={{ fontSize: isMobile ? 12 : 12.5, fontWeight: 500, opacity: isMobile ? 0.82 : 0.84, marginTop: 2 }}>{caption}</div>
          </div>
        </div>
        {isMobile ? mobileAction : actions}
      </div>

      {isMobile && stats && stats.length > 0 && (
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, marginTop: 16, padding: "13px 14px", borderRadius: 18, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.22)" }}>
          {stats.map((stat, index) => (
            <div key={stat.label} style={{ flex: 1, minWidth: 0, textAlign: "center", borderLeft: index > 0 ? "1px solid rgba(255,255,255,0.22)" : undefined }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.7px", opacity: 0.8, whiteSpace: "nowrap" }}>{stat.label}</div>
              <div style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: "-0.5px", marginTop: 3, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{shortRupees(stat.value)}</div>
            </div>
          ))}
        </div>
      )}

      {children}
    </section>
  );
}

/** The hero's glass pill — ghost on the left of the pair, solid on the right. */
export function HeroButton({ onClick, icon, children, solid, full }: {
  onClick: () => void; icon: ReactNode; children: ReactNode; solid?: boolean; full?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className="acc-press"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: solid ? "11px 22px" : "11px 20px", borderRadius: 999,
        background: solid ? "#fff" : "rgba(255,255,255,0.15)",
        border: solid ? "none" : "1px solid rgba(255,255,255,0.45)",
        color: solid ? X.darkest : "#fff",
        fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
        flex: full ? 1 : undefined,
      }}>
      {icon}
      <span style={{ whiteSpace: "nowrap" }}>{children}</span>
    </button>
  );
}

/** The phone's 40px glass tile. */
export function HeroTile({ onClick, label, d }: { onClick: () => void; label: string; d: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="acc-press"
      style={{ width: 40, height: 40, borderRadius: 13, background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.42)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "#fff" }}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </button>
  );
}

/**
 * The phone's period pill.
 *
 * The design draws it with "Change" beside the dates and nothing behind it.
 * Here it opens the two date fields, which are otherwise off the phone
 * entirely — the desktop's filter grid does not fit at 390px.
 */
export function PeriodPill({ from, to, open, onToggle, onFrom, onTo, maxTo, label }: {
  from: string; to: string; open: boolean; onToggle: () => void;
  onFrom: (v: string) => void; onTo: (v: string) => void; maxTo: string;
  /** Shown instead of the dates when the period is unbounded. */
  label?: string;
}) {
  return (
    <>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ position: "relative", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, padding: "9px 14px", borderRadius: 999, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.22)", color: "#fff", fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <rect x="4" y="5" width="16" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M4 11h16" />
          </svg>
          <span style={{ whiteSpace: "nowrap" }}>{label ?? `${from} → ${to}`}</span>
        </span>
        <span style={{ opacity: 0.82, whiteSpace: "nowrap" }}>{open ? "Done" : "Change"}</span>
      </button>

      {open && (
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ ...designLabel, color: "rgba(255,255,255,0.82)" }}>From</span>
            <input type="date" value={from} max={to || undefined} onChange={(event) => onFrom(event.target.value)}
              style={{ ...designField, fontSize: 16, background: "rgba(255,255,255,0.92)", borderColor: "rgba(255,255,255,0.5)" }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ ...designLabel, color: "rgba(255,255,255,0.82)" }}>To</span>
            <input type="date" value={to} min={from || undefined} max={maxTo} onChange={(event) => onTo(event.target.value)}
              style={{ ...designField, fontSize: 16, background: "rgba(255,255,255,0.92)", borderColor: "rgba(255,255,255,0.5)" }} />
          </label>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat cards                                                                  */
/* -------------------------------------------------------------------------- */

export interface StatCard {
  label: string;
  value: string;
  note: string;
  pill?: string | null;
  tone?: keyof typeof TONE;
  /** 0–100. The 5px bar under the figure. */
  pct: number;
  color: string;
  accent: string;
  icon: string;
}

export function StatCards({ cards, isMobile }: { cards: StatCard[]; isMobile: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(212px, 1fr))", gap: 12 }}>
      {cards.map((c) => {
        const pill = TONE[c.tone ?? "quiet"];
        return (
          <div key={c.label} style={{ position: "relative", overflow: "hidden", background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, padding: "15px 18px" }}>
            {/* The 3px accent stripe the design puts down every card. */}
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: c.accent }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <div style={{ width: 26, height: 26, borderRadius: 9, background: X.tint, color: c.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={c.icon} /></svg>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: X.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{c.label}</span>
              </div>
              {c.pill && (
                <span style={{ flexShrink: 0, padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", background: pill.tint, color: pill.color }}>{c.pill}</span>
              )}
            </div>
            <div style={{ fontSize: isMobile ? 21 : 25, fontWeight: 800, letterSpacing: "-0.9px", marginTop: 9, color: c.color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.value}</div>
            <div style={{ height: 5, borderRadius: 999, background: "#eef4f3", marginTop: 11, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(3, Math.min(100, c.pct))}%`, background: c.accent }} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: X.faint, marginTop: 7 }}>{c.note}</div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                        */
/* -------------------------------------------------------------------------- */

/** A segmented control on one `#dceae8` track, with the active pill in white. */
export function Segmented<T extends string>({ tabs, value, onChange, isMobile }: {
  tabs: ReadonlyArray<{ key: T; label: string; d: string }>;
  value: T; onChange: (next: T) => void; isMobile: boolean;
}) {
  return (
    <div style={{ display: isMobile ? "flex" : "inline-flex", alignItems: "center", gap: 4, padding: 4, borderRadius: 999, background: X.track, alignSelf: "flex-start" }}>
      {tabs.map(({ key, label, d }) => {
        const active = value === key;
        return (
          <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={active} className="acc-press"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "9px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700,
              cursor: "pointer", border: "none", fontFamily: "inherit",
              color: active ? X.deep : X.muted,
              background: active ? "#fff" : "transparent",
              boxShadow: active ? "0 1px 3px rgba(31,92,88,0.14)" : "none",
              flex: isMobile ? 1 : undefined,
            }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
            <span style={{ whiteSpace: "nowrap" }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

export interface SelectFilter {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  /** The design's own column width for this control. */
  width: string;
}

export function FilterPanel({
  from, to, maxTo, onFrom, onTo, search, onSearch, selects, onDownload, canDownload,
  periodLabel,
}: {
  /** Either may be `""`, which means **no bound on that side**. */
  from: string; to: string; maxTo: string;
  onFrom: (v: string) => void; onTo: (v: string) => void;
  search: string; onSearch: (v: string) => void;
  selects: SelectFilter[];
  onDownload: () => void; canDownload: boolean;
  /** Overrides the `from → to` pill — "All policies", when nothing is bounded. */
  periodLabel?: string;
}) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 18, padding: "16px 20px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>Period and Filters</span>
        <span style={{ padding: "4px 12px", borderRadius: 999, background: X.tint, border: `1px solid ${X.line}`, fontSize: 11.5, fontWeight: 700, color: X.deep, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {periodLabel ?? `${from} → ${to}`}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `150px 150px minmax(200px,1fr) ${selects.map((s) => s.width).join(" ")} auto`, gap: 12, alignItems: "end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, ...designLabel }}>
          <span>From</span>
          <input type="date" value={from} max={to || undefined} onChange={(event) => onFrom(event.target.value)} style={{ ...designField, fontSize: 13.5 }} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, ...designLabel }}>
          <span>To</span>
          <input type="date" value={to} min={from || undefined} max={maxTo} onChange={(event) => onTo(event.target.value)} style={{ ...designField, fontSize: 13.5 }} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, ...designLabel }}>
          <span>Search</span>
          <span style={{ display: "flex", alignItems: "center", gap: 9, border: `1px solid ${X.line}`, background: X.well, borderRadius: 10, padding: "10px 13px" }}>
            <SearchIcon />
            <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Title, payee or note"
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 13.5, fontWeight: 500, color: "#22302f", fontFamily: "inherit" }} />
          </span>
        </label>

        {selects.map((select) => (
          <label key={select.label} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, ...designLabel }}>
            <span>{select.label}</span>
            <select value={select.value} onChange={(event) => select.onChange(event.target.value)} style={{ ...designField, fontSize: 13.5, cursor: "pointer" }}>
              {select.options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ))}

        <button type="button" onClick={onDownload} disabled={!canDownload} className="acc-press"
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "11px 18px", borderRadius: 10,
            border: "1px solid #d6e5e3", background: "#fff", color: X.body,
            fontSize: 13, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
            cursor: canDownload ? "pointer" : "not-allowed", opacity: canDownload ? 1 : 0.5,
          }}>
          <Download size={15} />
          <span>CSV</span>
        </button>
      </div>
    </section>
  );
}

function SearchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#8fa2a0" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" />
    </svg>
  );
}

/** The phone's search pill. 16px, or iOS Safari zooms the page on focus. */
export function MobileSearch({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: `1px solid ${X.line}`, borderRadius: 999, padding: "11px 16px" }}>
      <SearchIcon size={16} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder}
        style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 16, fontWeight: 500, color: "#22302f", fontFamily: "inherit" }} />
    </div>
  );
}

export interface ChipModel {
  label: string;
  active: boolean;
  pick: () => void;
}

/** One row of chips that scrolls by thumb — the phone's whole filter bar. */
export function ChipRow({ chips }: { chips: ChipModel[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto", paddingBottom: 2, margin: "0 -2px" }}>
      {chips.map((chip) => (
        <button key={chip.label} type="button" onClick={chip.pick} aria-pressed={chip.active} className="acc-press"
          style={{
            display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
            padding: "9px 17px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
            border: `1px solid ${chip.active ? X.teal : X.line}`,
            background: chip.active ? X.teal : "#fff",
            color: chip.active ? "#fff" : X.muted,
          }}>
          {chip.active && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
          )}
          <span style={{ whiteSpace: "nowrap" }}>{chip.label}</span>
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

export interface RowAction {
  key: string;
  label: string;
  /** The label the phone's narrower pill uses, when it differs. */
  shortLabel?: string;
  d: string;
  tone: "good" | "bad" | "quiet";
  onClick: () => void;
  disabled?: boolean;
}

const ACTION_TONE: Record<RowAction["tone"], { color: string; border: string; hover: string }> = {
  good: { color: "#2f7d78", border: "#cfe2e0", hover: "#f2f8f7" },
  bad: { color: "#a8483c", border: "#f0dcd8", hover: "#fdeeec" },
  quiet: { color: "#5b6d6b", border: "#e2ecea", hover: "#f4f8f7" },
};

export interface ExpenseRowModel {
  id: string;
  title: string;
  /** The `date · category · who` line, already joined. */
  meta: string;
  amount: number;
  category: string;
  status: { label: string; tone: Tone };
  /** A second pill, for the payment state. Absent means no money has moved. */
  payment?: { label: string; tone: Tone } | null;
  notes?: ReactNode;
  /**
   * A **full-width band under the row**, for records whose figures do not fit
   * in a title and an amount.
   *
   * `notes` sits inside the title column and is right for a sentence; a marketing
   * receipt has five figures that each need a label, and squeezing those into a
   * `minmax(0,1fr)` column beside the amount and the actions is how a row
   * becomes unreadable. This spans the whole card instead — see `FigureStrip`.
   */
  detail?: ReactNode;
  actions: RowAction[];
  /** Opens the detail panel. The action pills stop propagation so they cannot. */
  onOpen: () => void;
}

/**
 * The rows, and the panel round them.
 *
 * Desktop is the design's `44px minmax(0,1fr) auto auto` grid; the phone is its
 * radius-20 card with a 3-up action row. Both are the **same row model** — a
 * money table becoming a reduced version below 820px is the failure this
 * project's rule 7 names.
 */
export function ExpenseList({
  heading, count, total, rows, isMobile, loading, empty, formatMoney: fmt, pager,
}: {
  heading: string;
  count: string;
  total: number;
  rows: ExpenseRowModel[];
  isMobile: boolean;
  loading: boolean;
  empty: string;
  formatMoney: (n: number) => string;
  pager?: ReactNode;
}) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 18, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: isMobile ? "13px 16px" : "14px 20px", borderBottom: `1px solid ${X.panelLine}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint, whiteSpace: "nowrap" }}>{heading}</span>
          <span style={{ padding: "2px 10px", borderRadius: 999, background: X.tint, border: `1px solid ${X.line}`, fontSize: 11, fontWeight: 700, color: X.deep, whiteSpace: "nowrap" }}>{count}</span>
        </div>
        <span style={{ fontSize: isMobile ? 14.5 : 15, fontWeight: 800, letterSpacing: "-0.4px", color: X.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(total)}</span>
      </div>

      {loading ? (
        <div style={{ padding: "54px 20px", textAlign: "center", fontSize: 13.5, fontWeight: 500, color: X.faint }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: isMobile ? "46px 12px" : "54px 20px", textAlign: "center", fontSize: 13.5, fontWeight: 500, color: X.faint }}>{empty}</div>
      ) : (
        <>
          <div style={isMobile ? { display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#f6faf9" } : undefined}>
            {rows.map((row) => (
              <ExpenseRow key={row.id} row={row} isMobile={isMobile} formatMoney={fmt} />
            ))}
          </div>
          {pager && <div style={{ padding: isMobile ? "0 14px 14px" : "12px 20px" }}>{pager}</div>}
        </>
      )}
    </section>
  );
}

function ExpenseRow({ row, isMobile, formatMoney: fmt }: {
  row: ExpenseRowModel; isMobile: boolean; formatMoney: (n: number) => string;
}) {
  const cat = catMeta(row.category);

  const icon = (
    <span aria-hidden style={{ width: isMobile ? 42 : 44, height: isMobile ? 42 : 44, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: cat.tint, color: cat.color }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={cat.d} /></svg>
    </span>
  );

  /** Desktop only — the phone puts these on their own row, see below. */
  const tags = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <Tag label={row.status.label} tone={row.status.tone} />
      {row.payment && <Tag label={row.payment.label} tone={row.payment.tone} />}
    </span>
  );

  const amount = (
    <span style={{ fontSize: isMobile ? 15.5 : 16, fontWeight: 800, letterSpacing: "-0.4px", color: X.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: isMobile ? undefined : 96, textAlign: "right" }}>
      {fmt(row.amount)}
    </span>
  );

  /*
    **The pills stop propagation.** The row itself opens the detail panel, so an
    Approve that also opened a panel behind itself would leave the reader
    looking at a record they had just changed and did not ask to see.
  */
  const pill = (action: RowAction, full: boolean) => {
    const tone = ACTION_TONE[action.tone];
    return (
      <button
        key={action.key}
        type="button"
        onClick={(event) => { event.stopPropagation(); action.onClick(); }}
        disabled={action.disabled}
        className="acc-press oe-pill"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: full ? "10px 6px" : "8px 14px",
          borderRadius: full ? 12 : 999,
          border: `1px solid ${tone.border}`,
          background: "#fff", color: tone.color,
          fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
          cursor: action.disabled ? "wait" : "pointer",
          opacity: action.disabled ? 0.55 : 1,
          fontFamily: "inherit",
          ["--oe-hover" as string]: tone.hover,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={action.tone === "bad" && action.key === "reject" ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={action.d} /></svg>
        <span>{full ? (action.shortLabel ?? action.label) : action.label}</span>
      </button>
    );
  };

  if (isMobile) {
    return (
      <article role="button" tabIndex={0} onClick={row.onOpen}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.onOpen(); } }}
        style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 20, padding: "15px 16px", minWidth: 0, cursor: "pointer", textAlign: "left" }}>
        {/*
          **The third column holds the amount and nothing else.**

          The design draws one short tag ("Approved") tucked under the figure,
          and that works right up until a tag is a sentence — StateLife's read
          "Rs 125,354 to come". An `auto` column sizes to its widest child, so
          two long tags took the row and `minmax(0,1fr)` did what it is told
          and shrank the name to **"M."** with the date at "2…". A card whose
          only job is to say whose policy this is was showing one letter of it.

          So the tags moved to their own full-width row underneath. Every value
          the design specifies is unchanged — radius, padding, type sizes, the
          tag geometry — only the position, which the design could not have
          anticipated because it never drew two tags or a long one.
        */}
        <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1fr) auto", alignItems: "center", gap: 13 }}>
          {icon}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.35px", color: X.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</div>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: X.faint, marginTop: 3, fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.meta}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>{amount}</div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
          <Tag label={row.status.label} tone={row.status.tone} />
          {row.payment && <Tag label={row.payment.label} tone={row.payment.tone} />}
        </div>

        {row.notes}
        {row.detail}
        {row.actions.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, row.actions.length)}, 1fr)`, gap: 8, marginTop: 13, paddingTop: 12, borderTop: `1px solid ${X.rowLine}` }}>
            {row.actions.map((action) => pill(action, true))}
          </div>
        )}
      </article>
    );
  }

  return (
    <div role="button" tabIndex={0} onClick={row.onOpen}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.onOpen(); } }}
      className="oe-row"
      style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) auto auto", alignItems: "center", columnGap: 16, rowGap: 0, padding: "15px 20px", borderBottom: `1px solid ${X.rowLine}`, cursor: "pointer", textAlign: "left" }}>
      {icon}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.35px", color: X.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.title}</div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: X.faint, marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.meta}</div>
        {row.notes}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        {tags}
        {amount}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 7, flexShrink: 0 }}>
        {row.actions.map((action) => pill(action, false))}
      </div>
      {/* The band spans all four columns, under everything above it. */}
      {row.detail && <div style={{ gridColumn: "1 / -1" }}>{row.detail}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The figure strip                                                            */
/* -------------------------------------------------------------------------- */

export interface Figure {
  label: string;
  value: string;
  /** Colours the figure. `strong` also gives it the row's heaviest weight. */
  tone?: "ink" | "good" | "warn" | "bad" | "muted";
  strong?: boolean;
  /** A second line under the figure — who a cut belongs to, say. */
  hint?: string | null;
}

const FIGURE_COLOR = {
  ink: X.ink,
  good: "#2f7d78",
  warn: "#a5762a",
  bad: "#a8483c",
  muted: X.faint,
} as const;

/**
 * A row of labelled figures, so a record with many numbers can be read at a
 * glance rather than decoded.
 *
 * **The label is the point.** Five bare amounts in a row are five numbers
 * somebody has to count along to identify; each one captioned in 9.5px
 * uppercase over a tabular figure means the eye lands on "TEAM" and reads
 * across. Cells wrap to `auto-fit` rather than scrolling sideways, so the same
 * strip works at 390px and at full width without a second implementation.
 */
export function FigureStrip({ figures, isMobile }: { figures: Figure[]; isMobile: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile
          ? "repeat(auto-fit, minmax(84px, 1fr))"
          : `repeat(${figures.length}, minmax(96px, 1fr))`,
        gap: 1,
        marginTop: 11,
        paddingTop: 11,
        borderTop: `1px solid ${X.rowLine}`,
        background: X.rowLine,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {figures.map((figure) => (
        <div key={figure.label} style={{ background: "#fff", padding: isMobile ? "9px 10px" : "9px 12px", minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.9px", textTransform: "uppercase", color: X.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {figure.label}
          </div>
          <div
            style={{
              fontSize: figure.strong ? 15 : 13.5,
              fontWeight: figure.strong ? 800 : 700,
              letterSpacing: "-0.3px",
              marginTop: 3,
              color: FIGURE_COLOR[figure.tone ?? "ink"],
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {figure.value}
          </div>
          {figure.hint && (
            <div style={{ fontSize: 10.5, fontWeight: 500, color: X.faint, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {figure.hint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** The same labelled pair, for a detail panel's own facts. */
export function FactRow({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...designLabel, fontSize: 9.5 }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: X.ink, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: X.faint, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function Tag({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 13px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", background: tone.tint, color: tone.color }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: tone.color }} />
      <span>{label}</span>
    </span>
  );
}

/** The phone's floating Add.
 *
 * `position: sticky`, never `fixed`: every page is wrapped in
 * `.animate-page-transition`, whose `will-change: transform` captures a fixed
 * descendant, and the phone's tab bar is a flow row a fixed control lands on.
 */
export function FloatingAdd({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div style={{ position: "sticky", bottom: 12, display: "flex", justifyContent: "flex-end", pointerEvents: "none", marginTop: 2, zIndex: 5 }}>
      <button type="button" onClick={onClick} className="acc-press"
        style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 9, padding: "14px 22px", borderRadius: 999, background: X.teal, color: "#fff", fontSize: 14, fontWeight: 700, border: "none", fontFamily: "inherit", boxShadow: "0 10px 24px rgba(31,92,88,0.34)", cursor: "pointer" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      </button>
    </div>
  );
}

/** The icon paths both screens use, named once. */
export const ICON = {
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  wallet: "M3 7h18v12H3zM3 11h18M7 15h4",
  calendar: "M4 5h16v16H4zM8 3v4M16 3v4M4 11h16",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  check: "M20 6 9 17l-5-5",
  cross: "M6 6l12 12M18 6 6 18",
  edit: "M4 20h4l11-11-4-4L4 16v4Z",
  trash: "M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13",
  tags: "M3 12V4h8l9 9-8 8-9-9Z",
  list: "M4 7h16M7 12h10M10 17h4",
  bars: "M5 20V10M12 20V4M19 20v-7",
  user: "M12 11a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM5 20c0-3.3 3.1-5.2 7-5.2s7 1.9 7 5.2",
  send: "M4 12l16-8-6 16-2.5-6.5L4 12Z",
} as const;

/* -------------------------------------------------------------------------- */
/* The detail panel                                                            */
/* -------------------------------------------------------------------------- */

export interface DetailField {
  label: string;
  value: ReactNode;
  /** Runs the full width of the grid — a purpose or a description. */
  wide?: boolean;
}

export interface FundingLeg {
  id: string;
  accountName: string;
  amount: number;
  dayKey: string;
  note?: string | null;
  by?: string | null;
}

export interface HistoryEntry {
  at: string;
  action: string;
  by?: string | null;
  detail?: string | null;
  amount?: number | null;
}

/**
 * One expense, opened.
 *
 * The list answers *what is there*; this answers *what happened to it* — who
 * filed it, who decided it and why, which accounts funded it and on which days,
 * and what is still owed. Those facts were all being written and none of them
 * were reachable from the screen: the row showed a title, a date and a status,
 * and the audit trail the Server Actions have appended to since the ledger
 * shipped had no reader at all.
 *
 * **The funding legs are read from the ledger, not from the expense.** The
 * expense's own `history` records that a payment was made; the transactions are
 * where the money actually is, and a panel that reported the first without the
 * second would go stale the moment a movement was deleted from its account.
 */
export function ExpenseDetail({
  title, amountLabel, status, payment, fields, legs, history, notFunded,
  formatMoney: fmt, actions, footnote, extra,
  legsHeading = "Where the money came from",
  legsIn = false,
}: {
  title: string;
  amountLabel: string;
  status: { label: string; tone: Tone };
  payment: { paid: number; outstanding: number; label: string; tone: Tone } | null;
  fields: DetailField[];
  legs: FundingLeg[];
  history: HistoryEntry[];
  /** Said in words when nothing has funded it, rather than an empty section. */
  notFunded: string;
  formatMoney: (n: number) => string;
  actions?: ReactNode;
  footnote?: ReactNode;
  /** Rendered between the figures and Details — the slab table, for StateLife. */
  extra?: ReactNode;
  legsHeading?: string;
  /**
   * `true` when the movements brought money **in** rather than took it out.
   *
   * An income account's receipts are `+` and teal; an expense's payments are
   * `−` and red. Same panel, and the sign is never decoration — a StateLife
   * slab shown as `−82,772` would read as money leaving the account it just
   * arrived in.
   */
  legsIn?: boolean;
}) {
  // Measured, never a media query — the standing rule in this project, and it
  // measures the viewport the panel is actually drawn in.
  const isNarrow = useIsMobile();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* The headline: the figure, what it is, and where it stands. */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, background: X.gradient, color: "#fff", padding: "18px 20px" }}>
        <svg viewBox="0 0 400 130" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.16 }} aria-hidden>
          <circle cx="356" cy="14" r="70" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="356" cy="14" r="108" fill="none" stroke="#fff" strokeWidth="1.2" />
        </svg>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, opacity: 0.86, wordBreak: "break-word" }}>{title}</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1.1px", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{amountLabel}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
            <Tag label={status.label} tone={status.tone} />
            {payment && <Tag label={payment.label} tone={payment.tone} />}
          </div>
        </div>
      </div>

      {payment && payment.paid > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Figure label="Paid" value={fmt(payment.paid)} color={X.deep} />
          <Figure label="Outstanding" value={fmt(payment.outstanding)} color={payment.outstanding > 0 ? "#a5762a" : X.faint} />
        </div>
      )}

      {extra}

      {/*
        **On a phone these are rows, not a grid.**

        Two columns of 9.5px uppercase labels fits, in the sense that nothing
        overflows — and reads badly: "PASS — THE COMMISSION BASE" wraps to three
        shouted lines above its number, and the eye has to zig-zag to pair
        fourteen labels with fourteen values. A phone has one column of
        attention. Label left, value right, one fact per line, and the values
        line up in a column somebody can read down.

        The desktop keeps the grid, where two columns of short labels are
        genuinely faster to scan than a long list.
      */}
      <Panel heading="Details">
        {isNarrow ? (
          <div>
            {fields.map((field, index) => (
              <div key={field.label}
                style={{
                  display: "flex", alignItems: "baseline", justifyContent: "space-between",
                  gap: 14, padding: "10px 16px",
                  borderTop: index === 0 ? undefined : `1px solid ${X.rowLine}`,
                }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: X.faint, flexShrink: 0, maxWidth: "52%" }}>
                  {field.label}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: X.ink, textAlign: "right", minWidth: 0, wordBreak: "break-word" }}>
                  {field.value || "—"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, padding: "14px 16px" }}>
            {fields.map((field) => (
              <div key={field.label} style={{ minWidth: 0, gridColumn: field.wide ? "1 / -1" : undefined }}>
                <div style={{ ...designLabel, fontSize: 9.5 }}>{field.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: X.ink, marginTop: 4, wordBreak: "break-word" }}>{field.value || "—"}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel heading={legsHeading} hint={legs.length ? `${legs.length} movement${legs.length === 1 ? "" : "s"}` : undefined}>
        {legs.length === 0 ? (
          <p style={{ padding: "20px 16px", fontSize: 12.5, fontWeight: 500, color: X.faint }}>{notFunded}</p>
        ) : (
          legs.map((leg) => (
            <div key={leg.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 16px", borderTop: `1px solid ${X.rowLine}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: X.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{leg.accountName}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                  {leg.dayKey}{leg.by ? ` · ${leg.by}` : ""}{leg.note ? ` · ${leg.note}` : ""}
                </div>
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: legsIn ? X.deep : "#a8483c", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {legsIn ? "+" : "−"}{fmt(leg.amount)}
              </span>
            </div>
          ))
        )}
      </Panel>

      <Panel heading="History" hint={history.length ? `${history.length} entr${history.length === 1 ? "y" : "ies"}` : undefined}>
        {history.length === 0 ? (
          <p style={{ padding: "20px 16px", fontSize: 12.5, fontWeight: 500, color: X.faint }}>Nothing has been recorded against this yet.</p>
        ) : (
          history.map((entry, index) => (
            <div key={`${entry.at}-${index}`} style={{ display: "flex", gap: 11, padding: "11px 16px", borderTop: `1px solid ${X.rowLine}` }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: X.teal, marginTop: 5, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: X.ink }}>
                  {entry.action}
                  {typeof entry.amount === "number" && <span style={{ color: X.deep }}> · {fmt(entry.amount)}</span>}
                </div>
                <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2 }}>
                  {entry.at}{entry.by ? ` · ${entry.by}` : ""}
                </div>
                {entry.detail && <div style={{ fontSize: 11.5, color: X.body, marginTop: 3, wordBreak: "break-word" }}>{entry.detail}</div>}
              </div>
            </div>
          ))
        )}
      </Panel>

      {footnote}
      {actions && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{actions}</div>}
    </div>
  );
}

function Figure({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 14, padding: "12px 15px" }}>
      <div style={{ ...designLabel, fontSize: 9.5 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.6px", color, marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Panel({ heading, hint, children }: { heading: string; hint?: string; children: ReactNode }) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${X.panelLine}`, background: X.tint }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>{heading}</span>
        {hint && <span style={{ fontSize: 11, fontWeight: 600, color: X.faint, whiteSpace: "nowrap" }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** A detail-panel action, in the row pill's shape at a readable size. */
export function DetailAction({ label, d, tone, onClick, disabled }: {
  label: string; d: string; tone: RowAction["tone"]; onClick: () => void; disabled?: boolean;
}) {
  const t = ACTION_TONE[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="acc-press oe-pill"
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 999,
        border: `1px solid ${t.border}`, background: "#fff", color: t.color,
        fontSize: 13, fontWeight: 700, cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.55 : 1, fontFamily: "inherit",
        ["--oe-hover" as string]: t.hover,
      }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
      <span>{label}</span>
    </button>
  );
}
