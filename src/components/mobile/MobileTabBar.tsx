"use client";

/**
 * The five-slot bottom bar from both design files.
 *
 * The centre slot is a raised 52px circle that sits `margin-top:-26px` so it
 * breaks the bar's top edge. What it does depends on who is looking:
 *
 * - **Admins and managers** get a small menu — Data Bank, Meta Ads, and for a
 *   manager their own Meta Leads — see `ADMIN_CENTRE` below.
 * - **Employees** get Meta Leads, always, for the same reason — see
 *   `EMPLOYEE_CENTRE`. It used to be the contextual action the mockups show (a
 *   phone to dial the lead on the acceptance clock, or a plus); the cost of
 *   replacing it is stated there.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { M } from "./mobileChrome";

export type CentreAction =
  | { kind: "call"; href: string }
  /** `label` names what is being added, so the button is not "Add a lead" on the directory. */
  | { kind: "add"; onPress: () => void; label?: string }
  /** A fixed destination rather than an action. */
  | { kind: "nav"; href: string; label: string; icon: CentreIcon }
  /** A short list of destinations — the button opens it rather than going anywhere. */
  | { kind: "menu"; label: string; icon: CentreIcon; items: CentreMenuItem[] }
  | null;

type CentreIcon = "database" | "megaphone";

export interface CentreMenuItem {
  label: string;
  /** One line saying what is behind it, so the menu is not three bare words. */
  hint: string;
  href: string;
  icon: CentreIcon;
}

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
/*
 * **Now a menu, not one destination** (owner, 2026-09-17: "if I click on the
 * databank button it should give option like databank or meta, then meta
 * leads"). The Data Bank and the Meta Ads campaigns are two halves of where
 * leads come from, and the bar has no sixth slot for the second. Still a fixed
 * set, for the same reason as before: nobody learns a button whose contents move.
 */
const ADMIN_CENTRE: CentreAction = {
  kind: "menu",
  label: "Data Bank and Meta Ads",
  icon: "database",
  items: [
    { label: "Data Bank", hint: "Lead sources and imported lists", href: "/admin/data-bank", icon: "database" },
    { label: "Meta Ads", hint: "Campaigns sending Facebook and WhatsApp leads", href: "/admin/meta-ads", icon: "megaphone" },
  ],
};

/** The same for a sub admin, plus the leads offered to them when they are in the rotation. */
const SUBADMIN_CENTRE: CentreAction = {
  kind: "menu",
  label: "Data Bank and Meta",
  icon: "database",
  items: [
    { label: "My Sources", hint: "Your Data Bank folders", href: "/subadmin/data-bank", icon: "database" },
    { label: "Meta Ads", hint: "Campaigns sending your team's leads", href: "/subadmin/meta-ads", icon: "megaphone" },
    { label: "Meta Leads", hint: "Facebook leads offered to you", href: "/subadmin/meta-leads", icon: "megaphone" },
  ],
};

/**
 * An employee's centre slot is Meta Leads, on every screen.
 *
 * **The phone had no route to it at all.** The Meta Leads entry was added to
 * the sidebar, which is the desktop shell — below 820px the app renders a
 * separate product with a five-slot tab bar, and none of those slots led there.
 * A screen that only exists on one surface is a screen half the team cannot
 * reach, and this is the one carrying a five-minute clock.
 *
 * Same argument as `ADMIN_CENTRE`: a *destination* rather than a contextual
 * action, because nobody learns where a button is if it is only sometimes
 * there, and the five slots have no room for a sixth tab.
 *
 * **The cost, stated plainly:** an employee loses the contextual "call whoever
 * is on the acceptance clock" button that used to sit here. What replaces it is
 * the screen that lists every lead on that clock — with the number, Accept and
 * Pass on — so the lead is one tap further away rather than unreachable, and
 * the slide-in popup still offers both answers wherever they are in the app.
 */
const EMPLOYEE_CENTRE: CentreAction = {
  kind: "nav",
  href: "/employee/meta-leads",
  label: "Meta Leads",
  // It drew the Data Bank's discs, which is not what it opens.
  icon: "megaphone",
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
  /*
    **"Accounts" replaces "Money" — for the admin only.**

    Money was a hub of links to reports and payouts; Accounts is where the money
    actually is, and it is the section the product has grown around: every
    module now pays from the same ledger. But Accounts is admin-and-HR, and its
    routes live under `/admin`, so a sub admin or an employee keeps Money — a
    tab that lands on a permission error is worse than the tab it replaced.
  */
  const money = isAdmin ? "/admin/accounts" : isSubAdmin ? "/subadmin/money" : "/employee/money";

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
      key: "money",
      label: isAdmin ? "Accounts" : "Money",
      // A wallet rather than a document: the slot is about money now, and the
      // page icon should say so before the label is read.
      d: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2",
      href: money,
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
  /*
    **Every role now has a fixed destination, so `centre` is only reached
    before the role is known** — one or two frames while auth resolves. Three
    screens still compute and publish a contextual action through
    `useMobileCentre` (`MobileDashboard`, `MobileLeads`, `MobileEmployees`) and
    nothing reads them any more. That is dead weight rather than a bug, and
    removing the mechanism is a separate change from adding this destination —
    recorded here so the next person does not spend an afternoon working out
    why their contextual button never appears.
  */
  const centreAction =
    role === "admin"
      ? ADMIN_CENTRE
      : role === "subadmin"
        ? SUBADMIN_CENTRE
        : role === "employee"
          ? EMPLOYEE_CENTRE
          : centre;

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

          /*
            `/home` matches only itself. **Accounts matches its whole section**,
            because it is the one tab you navigate *within*: an unlit tab on
            `/admin/accounts/statelife` would say you had left the section you
            are standing in. Leads keeps its exact match — `/admin/leads/campaigns`
            is a different destination, not a page inside the leads tab.
          */
          const active =
            tab.href === "/home"
              ? pathname === "/home"
              : tab.key === "money"
                ? pathname === tab.href || pathname.startsWith(`${tab.href}/`)
                : pathname === tab.href;

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
        <CentreGlyph icon={action.icon} stroke="#fff" />
      </Link>
    );
  }

  if (action.kind === "menu") {
    return <CentreMenu action={action} circle={circle} />;
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

function CentreGlyph({ icon, stroke, size = 22 }: { icon: CentreIcon; stroke: string; size?: number }) {
  return icon === "megaphone" ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 11v3l12 5V6L4 11ZM16 9a3 3 0 0 1 0 6M6 14v5h3v-4" />
    </svg>
  ) : (
    // A stack of discs — the same database mark the sidebar uses.
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </svg>
  );
}

const noopSubscribe = () => () => {};
/** False on the server and on the first client render, so the portal never mismatches hydration. */
const useMounted = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

const MENU_CSS = `
@keyframes centre-menu-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.centre-menu-sheet { animation: centre-menu-in 240ms cubic-bezier(0.22,0.61,0.36,1) both; }
@media (prefers-reduced-motion: reduce) { .centre-menu-sheet { animation: none !important; } }
`;

/**
 * The centre button's menu.
 *
 * **Portalled to the body**: every page sits inside `.animate-page-transition`,
 * whose `will-change: transform` would pin a fixed panel to the page instead of
 * the screen. **Open is tied to the path it was opened on**, so moving to
 * another screen closes it without an effect setting state — the project's lint
 * rule refuses that.
 */
function CentreMenu({
  action,
  circle,
}: {
  action: Extract<CentreAction, { kind: "menu" }>;
  circle: React.CSSProperties;
}) {
  const pathname = usePathname();
  const mounted = useMounted();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const here = action.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={action.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenOn(open ? null : pathname)}
        style={{
          ...circle,
          // A ring when the current screen is one of its destinations, since the
          // button itself goes nowhere and cannot otherwise show where you are.
          boxShadow: here ? `0 0 0 3px ${M.cardBg}, 0 0 0 5px ${M.teal}` : circle.boxShadow,
          transform: open ? "rotate(0deg) scale(0.94)" : undefined,
        }}
      >
        <CentreGlyph icon={action.icon} stroke="#fff" />
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            role="presentation"
            onClick={() => setOpenOn(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 60,
              background: "rgba(20,40,38,0.32)",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              padding: "0 12px calc(env(safe-area-inset-bottom, 0px) + 92px)",
            }}
          >
            <style>{MENU_CSS}</style>
            <div
              role="menu"
              aria-label={action.label}
              className="centre-menu-sheet"
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 420,
                background: M.cardBg,
                borderRadius: 20,
                border: `1px solid ${M.cardBorder}`,
                boxShadow: "0 18px 40px rgba(20,40,38,0.22)",
                padding: 8,
              }}
            >
              {action.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    role="menuitem"
                    href={item.href}
                    onClick={() => setOpenOn(null)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 12px",
                      borderRadius: 14,
                      background: active ? "#e8f5f3" : "transparent",
                      textDecoration: "none",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        background: active ? M.teal : "#e8f5f3",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <CentreGlyph icon={item.icon} stroke={active ? "#fff" : M.tealDeep} size={19} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: "#2b3a39" }}>
                        {item.label}
                      </span>
                      <span style={{ display: "block", fontSize: 12.5, color: "#7e918f", marginTop: 1 }}>
                        {item.hint}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
