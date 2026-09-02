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

const ADMIN_DESTINATIONS: Destination[] = [
  { label: "Campaigns", path: "/admin/leads/campaigns", d: "M4 11v3l12 5V6L4 11ZM16 9a3 3 0 0 1 0 6M6 14v5h3v-4" },
  { label: "Priority Settings", path: "/admin/employees/priority", d: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" },
  { label: "Closed Deals", path: "/admin/financials/deals", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12l2.5 2.5 4.5-5" },
  { label: "Profit Distribution", path: "/admin/financials/distribution", d: "M12 3v9l7 4M21 12a9 9 0 1 1-9-9" },
  { label: "Office Expenses", path: "/admin/financials/expenses", d: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2" },
  { label: "Reports", path: "/admin/financials/reports", d: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" },
  { label: "Income Sheet", path: "/admin/accounts/income-sheet", d: "M4 19h16M7 16V9M12 16V5M17 16v-4" },
  { label: "Search", path: "/admin/search", d: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16.5 16.5 21 21" },
  { label: "Settings", path: "/admin/settings", d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 4.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11h0a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" },
];

const EMPLOYEE_DESTINATIONS: Destination[] = [
  { label: "My Stats", path: "/employee/performance/stats", d: "M4 19h16M7 16V9M12 16V5M17 16v-4" },
  { label: "My Earnings", path: "/employee/earnings", d: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2" },
];

/**
 * A sub admin's account sheet.
 *
 * Only what is theirs — their folders, their team, their money. The admin's
 * company financials and the accounts module are absent because they are not a
 * sub admin's to see, and a link that lands on a permission error is worse than
 * no link.
 */
const SUBADMIN_DESTINATIONS: Destination[] = [
  { label: "My Sources", path: "/subadmin/data-bank", d: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
  { label: "Team Performance", path: "/subadmin/team", d: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11ZM2.5 20c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5M17 5a3.2 3.2 0 0 1 0 6.4" },
  { label: "My Earnings", path: "/subadmin/earnings", d: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2" },
];

function destinationsFor(role: string | undefined): Destination[] {
  if (role === "admin") return ADMIN_DESTINATIONS;
  if (role === "subadmin") return SUBADMIN_DESTINATIONS;
  if (role === "employee") return EMPLOYEE_DESTINATIONS;
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
  const destinations = destinationsFor(role ?? undefined);

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

          {destinations.length === 0 && (
            <div style={{ padding: "18px 6px", fontSize: 12.5, fontWeight: 500, color: M.faint }}>
              Nothing else is available for this account.
            </div>
          )}

          {destinations.map((destination) => {
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
