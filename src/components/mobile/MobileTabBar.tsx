"use client";

/**
 * The five-slot bottom bar from both design files.
 *
 * The centre slot is a raised 52px circle that sits `margin-top:-26px` so it
 * breaks the bar's top edge. What it does depends on who is looking:
 *
 * - **Admins** get the Data Bank, always — see `ADMIN_CENTRE` below.
 * - **Employees** get the contextual action the two mockups show: a phone to
 *   dial the lead on the acceptance clock, or a plus. Neither is decoration;
 *   with nothing to dial the slot is empty rather than offering a dead button.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { M } from "./mobileChrome";

export type CentreAction =
  | { kind: "call"; href: string }
  /** `label` names what is being added, so the button is not "Add a lead" on the directory. */
  | { kind: "add"; onPress: () => void; label?: string }
  /** A fixed destination rather than an action — the admin's Data Bank. */
  | { kind: "nav"; href: string; label: string }
  | null;

/**
 * The admin's centre slot is the Data Bank, on every screen.
 *
 * It is a *destination*, not a contextual action, and that is the whole point:
 * the Data Bank is where an admin's manual work now lives (the pipeline no
 * longer has an Add Lead button), and the five-slot bar has no room for a
 * sixth tab. A navigation target that moved or disappeared depending on the
 * screen would be worse than not having one — nobody learns where a button is
 * if it is only sometimes there.
 *
 * The cost, stated plainly: an admin no longer gets the contextual "call
 * whoever is on the acceptance clock" button that used to sit here. That is an
 * employee's job, and the lead is one tap away in the pipeline either way.
 * Employees keep the contextual centre exactly as it was.
 */
const ADMIN_CENTRE: CentreAction = {
  kind: "nav",
  href: "/admin/data-bank",
  label: "Data Bank",
};

/** The same reasoning for a sub admin, pointed at their own folders. */
const SUBADMIN_CENTRE: CentreAction = {
  kind: "nav",
  href: "/subadmin/data-bank",
  label: "Data Bank",
};

interface Tab {
  key: string;
  label: string;
  d: string;
  href: string;
}

/** Paths taken from the design's own `TABS`, mapped to this app's routes. */
export function tabsForRole(role: string | undefined): Tab[] {
  const isAdmin = role === "admin";
  const isSubAdmin = role === "subadmin";
  // A manager's bar and an employee's differ in destination, not in shape: the
  // five slots stay in the same order for everyone, so nobody has to relearn
  // the bar when their role changes.
  const leads = isAdmin ? "/admin/leads" : isSubAdmin ? "/subadmin/leads" : "/employee/leads";
  const team = isAdmin
    ? "/admin/employees/directory"
    : isSubAdmin
      ? "/subadmin/team"
      : "/employee/performance/stats";
  const reports = isAdmin
    ? "/admin/financials/reports"
    : isSubAdmin
      ? "/subadmin/earnings"
      : "/employee/performance/stats";

  return [
    { key: "home", label: "Home", d: "M4 11 12 4l8 7v9H4z", href: "/home" },
    {
      key: "leads",
      label: "Leads",
      d: "M4 6h16M4 12h10M4 18h13",
      href: leads,
    },
    {
      key: "team",
      label: isAdmin || isSubAdmin ? "Team" : "Deals",
      d:
        isAdmin || isSubAdmin
          ? "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11ZM2.5 20c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5M17 5a3.2 3.2 0 0 1 0 6.4"
          : "M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5s2 2.8 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3",
      href: team,
    },
    {
      key: "reports",
      label: isSubAdmin ? "Earnings" : "Reports",
      d: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
      href: reports,
    },
  ];
}

export function MobileTabBar({
  role,
  centre,
}: {
  role: string | undefined;
  centre: CentreAction;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = tabsForRole(role);
  // The centre sits between slot 2 and slot 3, as both design files lay it out.
  const slots = [tabs[0], tabs[1], null, tabs[2], tabs[3]];
  // An admin's centre is fixed; an employee's stays contextual.
  const centreAction =
    role === "admin" ? ADMIN_CENTRE : role === "subadmin" ? SUBADMIN_CENTRE : centre;

  return (
    <nav
      style={{
        position: "relative",
        background: M.cardBg,
        borderTop: `1px solid ${M.cardBorder}`,
        padding: "10px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)",
        flexShrink: 0,
        zIndex: 20,
      }}
      aria-label="Primary"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", alignItems: "end" }}>
        {slots.map((tab, index) => {
          if (!tab) {
            return (
              <div key="centre" style={{ display: "flex", justifyContent: "center" }}>
                <CentreButton action={centreAction} />
              </div>
            );
          }

          // `/admin/leads` must not light up on `/admin/leads/campaigns`, and
          // `/home` must match only itself.
          const active =
            tab.href === "/home" ? pathname === "/home" : pathname === tab.href;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => router.push(tab.href)}
              aria-current={active ? "page" : undefined}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 5,
                padding: "4px 0",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                color: active ? M.tealDeep : "#93a5a3",
                transition: "color 160ms ease",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={tab.d} />
              </svg>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1px" }}>{tab.label}</span>
              {index === 0 && active && <span className="sr-only">(current)</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function CentreButton({ action }: { action: CentreAction }) {
  if (!action) return null;

  const circle: React.CSSProperties = {
    width: M.centreAction,
    height: M.centreAction,
    borderRadius: "50%",
    background: M.teal,
    boxShadow: "0 8px 18px rgba(31,92,88,0.34)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: -26,
    border: "none",
    padding: 0,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    // Scale only — a transform never triggers layout, so the press stays
    // smooth on a low-end device.
    transition: "transform 140ms ease",
  };

  if (action.kind === "nav") {
    return (
      <Link href={action.href} aria-label={action.label} style={circle}>
        {/* A stack of discs — the same database mark the sidebar uses. */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <ellipse cx="12" cy="6" rx="7.5" ry="3" />
          <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
        </svg>
      </Link>
    );
  }

  if (action.kind === "call") {
    return (
      <a href={action.href} aria-label="Call the lead waiting to be accepted" style={circle}>
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M5 4h3l2 5-2.2 1.6a12 12 0 0 0 5.6 5.6L15 14l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3 6.2 2 2 0 0 1 5 4Z" />
        </svg>
      </a>
    );
  }

  return (
    <button type="button" onClick={action.onPress} aria-label={action.label ?? "Add a lead"} style={circle}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}
