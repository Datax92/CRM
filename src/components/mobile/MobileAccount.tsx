"use client";

/**
 * The account chip every phone header carries, and the sheet behind it.
 *
 * The phone layout has five tab slots for a sidebar with fifteen destinations,
 * so the avatar is where the rest of the app lives: the signed-in identity,
 * the sections the tab bar has no room for, and **Sign out** — which the phone
 * had no route to at all before this.
 *
 * The destinations come from the same role split as `GlobalLayout`'s sidebar.
 * They are listed here rather than imported because the sidebar's shape is a
 * nested accordion of categories and this is a flat list; sharing the tree
 * would mean flattening it at render time on every open.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { M } from "./mobileChrome";

interface Destination {
  label: string;
  path: string;
  /** Lucide-style 24×24 path data, matching the tab bar's icon set. */
  d: string;
}

/**
 * A group of destinations, mirroring one accordion in the web sidebar.
 *
 * **The sheet is two levels, not one flat list.** Twenty-odd links in a single
 * column is a scroll nobody reads to the end of, and it throws away the
 * grouping the sidebar already teaches — Attendance, Money, Clients. Tapping a
 * section drills in; a back arrow comes out. A section holding a single
 * destination is flattened into a plain row instead, because drilling into one
 * item is a tap that buys nothing.
 */
interface Section {
  title: string;
  d: string;
  items: Destination[];
}

const I = {
  attendance: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8.5 14.5l2.5 2.5 4.5-5",
  money: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M12 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  clients: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11ZM2.5 20c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5M17 5a3.2 3.2 0 0 1 0 6.4",
  team: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11ZM2.5 20c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5M17 5a3.2 3.2 0 0 1 0 6.4",
  report: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 12h2M14 12h2M8 16h2M14 16h2",
  dash: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  deals: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12l2.5 2.5 4.5-5",
  pie: "M12 3v9l7 4M21 12a9 9 0 1 1-9-9",
  receipt: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2",
  sheet: "M4 19h16M7 16V9M12 16V5M17 16v-4",
  folder: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  megaphone: "M4 11v3l12 5V6L4 11ZM16 9a3 3 0 0 1 0 6M6 14v5h3v-4",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  wallet: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2",
} as const;

const ADMIN_SECTIONS: Section[] = [
  {
    title: "Attendance",
    d: I.attendance,
    items: [
      { label: "Dashboard", path: "/admin/attendance", d: I.dash },
      { label: "My Attendance", path: "/admin/attendance/me", d: I.clock },
      { label: "Calendar", path: "/admin/attendance/calendar", d: I.calendar },
      { label: "Leave Management", path: "/admin/attendance/leave", d: I.calendar },
      { label: "Attendance Reports", path: "/admin/attendance/reports", d: I.report },
      { label: "Late / Absence", path: "/admin/attendance/records", d: I.alert },
      { label: "Settings", path: "/admin/attendance/settings", d: I.settings },
    ],
  },
  {
    title: "Money",
    d: I.money,
    items: [
      { label: "Closed Deals", path: "/admin/financials/deals", d: I.deals },
      { label: "Profit Distribution", path: "/admin/financials/distribution", d: I.pie },
      { label: "Salary / Payroll", path: "/admin/financials/payroll", d: I.money },
      { label: "Office Expenses", path: "/admin/financials/expenses", d: I.receipt },
      { label: "Financial Reports", path: "/admin/financials/reports", d: I.report },
      { label: "Income Sheet", path: "/admin/accounts/income-sheet", d: I.sheet },
      { label: "Receivables", path: "/admin/accounts/receivable", d: I.receipt },
      { label: "Investments", path: "/admin/accounts/investment", d: I.sheet },
    ],
  },
  {
    title: "Team",
    d: I.team,
    items: [
      { label: "Directory", path: "/admin/employees/directory", d: I.team },
      { label: "Summary Report", path: "/admin/team/reports", d: I.report },
      { label: "Priority Settings", path: "/admin/employees/priority", d: I.sliders },
    ],
  },
  {
    title: "Leads",
    d: I.megaphone,
    items: [
      { label: "Data Bank", path: "/admin/data-bank", d: I.folder },
      { label: "Campaigns", path: "/admin/leads/campaigns", d: I.megaphone },
    ],
  },
  { title: "Clients", d: I.clients, items: [{ label: "Clients", path: "/admin/clients", d: I.clients }] },
  { title: "Settings", d: I.settings, items: [{ label: "Settings", path: "/admin/settings", d: I.settings }] },
];

const SUBADMIN_SECTIONS: Section[] = [
  {
    title: "Attendance",
    d: I.attendance,
    items: [
      { label: "Dashboard", path: "/subadmin/attendance", d: I.dash },
      { label: "My Attendance", path: "/subadmin/attendance/me", d: I.clock },
      { label: "Calendar", path: "/subadmin/attendance/calendar", d: I.calendar },
      { label: "Leave Management", path: "/subadmin/attendance/leave", d: I.calendar },
      { label: "Attendance Reports", path: "/subadmin/attendance/reports", d: I.report },
      { label: "Late / Absence", path: "/subadmin/attendance/records", d: I.alert },
    ],
  },
  {
    title: "Money",
    d: I.money,
    items: [
      { label: "My Earnings", path: "/subadmin/earnings", d: I.wallet },
      { label: "My Salary", path: "/subadmin/salary", d: I.money },
    ],
  },
  {
    title: "Team",
    d: I.team,
    items: [
      { label: "Team Performance", path: "/subadmin/team", d: I.team },
      { label: "Summary Report", path: "/subadmin/reports", d: I.report },
    ],
  },
  { title: "Clients", d: I.clients, items: [{ label: "Clients", path: "/subadmin/clients", d: I.clients }] },
  { title: "Data Bank", d: I.folder, items: [{ label: "My Sources", path: "/subadmin/data-bank", d: I.folder }] },
];

const EMPLOYEE_SECTIONS: Section[] = [
  {
    title: "Attendance",
    d: I.attendance,
    items: [
      { label: "My Attendance", path: "/employee/attendance", d: I.clock },
      { label: "Calendar", path: "/employee/attendance/calendar", d: I.calendar },
      { label: "My Leave", path: "/employee/attendance/leave", d: I.calendar },
    ],
  },
  {
    title: "Money",
    d: I.money,
    items: [
      { label: "My Earnings", path: "/employee/earnings", d: I.wallet },
      { label: "My Salary", path: "/employee/salary", d: I.money },
    ],
  },
  {
    title: "Performance",
    d: I.report,
    items: [
      { label: "My Stats", path: "/employee/performance/stats", d: I.sheet },
      { label: "My Report", path: "/employee/reports", d: I.report },
    ],
  },
];

function sectionsFor(role: string | undefined): Section[] {
  if (role === "admin") return ADMIN_SECTIONS;
  if (role === "subadmin") return SUBADMIN_SECTIONS;
  if (role === "employee") return EMPLOYEE_SECTIONS;
  return [];
}

/**
 * The 38px filled circle in the header. Tapping it opens the account sheet.
 *
 * `initial` is passed in rather than derived here because the dashboard already
 * resolves a real display name from the profile document, and the header should
 * show the same letter the greeting does.
 */
export function AccountButton({ initial, size = 38 }: { initial?: string; size?: number }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const letter = (initial ?? user?.email ?? "U").trim().charAt(0).toUpperCase() || "U";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Account and settings"
        aria-haspopup="dialog"
        className="mob-press"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          border: "none",
          padding: 0,
          flexShrink: 0,
          background: "#fff",
          color: M.tealDeep,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 800,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {letter}
      </button>

      {open && <AccountSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function AccountSheet({ onClose }: { onClose: () => void }) {
  const { user, role, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  const name = user?.email?.split("@")[0] ?? "User";
  const sections = sectionsFor(role ?? undefined);
  /** `null` at the top level; a section title once drilled in. */
  const [openSection, setOpenSection] = useState<string | null>(null);

  const section = sections.find((entry) => entry.title === openSection) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (path: string) => {
    onClose();
    router.push(path);
  };

  /**
   * Sign out, then replace rather than push — a back gesture must not land on
   * a signed-in screen rendered from the bfcache.
   */
  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      router.replace("/");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div
      className="mob-fade"
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        background: "rgba(24,52,50,0.42)",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <div
        className="mob-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        style={{
          width: "100%",
          maxHeight: "88%",
          background: M.cardBg,
          borderRadius: `${M.sheetRadius}px ${M.sheetRadius}px 0 0`,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          overflow: "hidden",
        }}
      >
        {/* ---- identity ---- */}
        <div style={{ padding: "14px 20px 14px" }}>
          <div style={{ width: 44, height: 4, borderRadius: 999, background: M.cardBorder, margin: "0 auto 16px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: M.tealTint,
                color: M.tealDeep,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 17,
                fontWeight: 800,
                flexShrink: 0,
              }}
              aria-hidden
            >
              {name.charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 16.5,
                  fontWeight: 800,
                  letterSpacing: "-0.4px",
                  color: M.ink,
                  textTransform: "capitalize",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {name}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: M.faint,
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {user?.email ?? "—"}
              </div>
            </div>
            <span
              style={{
                flexShrink: 0,
                padding: "5px 12px",
                borderRadius: 999,
                background: M.tealTint,
                color: M.tealDeep,
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.7px",
                textTransform: "uppercase",
              }}
            >
              {role ?? "—"}
            </span>
          </div>
        </div>

        {/* ---- destinations ---- */}
        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            padding: "4px 14px 14px",
          }}
        >
          {/* Back out of a section, or the top-level heading. */}
          {section ? (
            <button
              type="button"
              onClick={() => setOpenSection(null)}
              className="mob-press"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "none",
                background: "transparent",
                color: M.tealDeep,
                padding: "8px 6px 6px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m15 6-6 6 6 6" />
              </svg>
              {section.title}
            </button>
          ) : (
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "1.1px",
                textTransform: "uppercase",
                color: M.fainter,
                padding: "8px 6px 6px",
              }}
            >
              More
            </div>
          )}

          {sections.length === 0 && (
            <div style={{ padding: "18px 6px", fontSize: 12.5, fontWeight: 500, color: M.faint }}>
              Nothing else is available for this account.
            </div>
          )}

          {/* A section with one destination is flattened — drilling into a
              single item is a tap that buys nothing. */}
          {!section &&
            sections.map((entry) => {
              const single = entry.items.length === 1 ? entry.items[0] : null;
              const active = single
                ? pathname === single.path
                : entry.items.some((item) => pathname === item.path);

              return (
                <SheetRow
                  key={entry.title}
                  label={single ? single.label : entry.title}
                  d={entry.d}
                  active={active}
                  badge={single ? undefined : `${entry.items.length}`}
                  onPress={() => (single ? go(single.path) : setOpenSection(entry.title))}
                />
              );
            })}

          {section?.items.map((destination) => {
            const active = pathname === destination.path;
            return (
              <button
                key={destination.path}
                type="button"
                onClick={() => go(destination.path)}
                aria-current={active ? "page" : undefined}
                className="mob-press"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  width: "100%",
                  textAlign: "left",
                  padding: "13px 12px",
                  borderRadius: M.rowRadius,
                  border: "none",
                  background: active ? M.tealTint : "transparent",
                  color: active ? M.tealDeep : M.body,
                  fontSize: 14.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    background: active ? "#fff" : "#f2f8f7",
                    color: M.tealDeep,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={destination.d} />
                  </svg>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{destination.label}</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={M.ghost} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            );
          })}
        </div>

        {/* ---- sign out ---- */}
        <div
          style={{
            padding: "12px 20px calc(env(safe-area-inset-bottom, 0px) + 22px)",
            borderTop: `1px solid ${M.divider}`,
          }}
        >
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="mob-press"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              width: "100%",
              padding: 15,
              borderRadius: 999,
              border: `1px solid ${M.red}`,
              background: "#fdeeec",
              color: M.red,
              fontSize: 14.5,
              fontWeight: 700,
              cursor: signingOut ? "progress" : "pointer",
              opacity: signingOut ? 0.6 : 1,
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** One row in the account sheet — a section, or a destination inside one. */
function SheetRow({
  label,
  d,
  active,
  badge,
  onPress,
}: {
  label: string;
  d: string;
  active: boolean;
  badge?: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-current={active ? "page" : undefined}
      className="mob-press"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        width: "100%",
        textAlign: "left",
        padding: "13px 12px",
        borderRadius: M.rowRadius,
        border: "none",
        background: active ? M.tealTint : "transparent",
        color: active ? M.tealDeep : M.body,
        fontSize: 14.5,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          background: active ? "#fff" : "#f2f8f7",
          color: M.tealDeep,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        aria-hidden
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={d} />
        </svg>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {badge && (
        <span
          style={{
            flexShrink: 0,
            borderRadius: 999,
            background: "#f2f8f7",
            color: M.faint,
            padding: "2px 9px",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {badge}
        </span>
      )}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={M.ghost} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m9 6 6 6-6 6" />
      </svg>
    </button>
  );
}
