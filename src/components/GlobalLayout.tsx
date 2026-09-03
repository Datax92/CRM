"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Menu, X, Home, Briefcase, LogOut, Target, Users, DollarSign,
  Activity, Search, ChevronDown, Wallet,
  Settings, ChevronsLeft, ChevronsRight, Database, FolderOpen,
  ListChecks, IdCard, SlidersHorizontal,
  Handshake, Receipt, FileBarChart, Users2, Building2, TrendingUp,
  PiggyBank, ReceiptText, Wallet2, BarChart3, Megaphone, PieChart,
  CalendarCheck, CalendarDays, CalendarClock, UserCheck, AlertTriangle, LayoutDashboard,
  BadgeDollarSign
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileShell } from "./mobile/MobileShell";
import { NotificationsPanel } from "./NotificationsPanel";
import Link from "next/link";
import { BrandLogo } from "./BrandLogo";

/**
 * The height a rail flyout is guaranteed, so it is never squeezed into a
 * sliver against the bottom of the screen. Anything past this scrolls.
 */
const MIN_FLYOUT_HEIGHT = 260;

export function GlobalLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  // Collapsed by default: the rail is the design's resting state, and the
  // toggle in the footer opens the full labelled sidebar for anyone who
  // prefers it. The choice survives navigation because this layout never
  // unmounts.
  const [isCollapsed, setCollapsed] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  // Which rail section has its flyout open. Only meaningful while collapsed.
  /**
   * The collapsed rail's flyout menu.
   *
   * It carries **where to draw the panel**, not just which one is open.
   * Anchored to the rail item with `absolute top-0` it ran straight off the
   * bottom of the screen for any menu with more than four entries —
   * Attendance has seven — and the panel clipped rather than scrolled, so the
   * last items simply could not be reached.
   *
   * Position is measured from the button and clamped into the viewport, and
   * the panel is `position: fixed`, which also frees it from every clipping
   * ancestor between here and the rail.
   */
  const [railFlyout, setRailFlyout] = useState<{
    title: string;
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const [topbarSearch, setTopbarSearch] = useState("");
  const profileRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { user, role, isHr, logout, getIdToken } = useAuth();
  const router = useRouter();
  // Phones get their own shell — a teal header per screen and a bottom tab
  // bar — rather than a narrowed sidebar. Measured in JS, not a media query;
  // see `hooks/useIsMobile` for why.
  const isMobile = useIsMobile();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
      if (railRef.current && !railRef.current.contains(e.target as Node)) {
        setRailFlyout(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailFlyout(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  // Close sidebar on route change (skip the no-op set when already closed,
  // so this doesn't fire a synchronous setState on every render pass).
  useEffect(() => {
    setSidebarOpen((open) => (open ? false : open));
  }, [pathname]);

  /**
   * The flyout's position is measured once, when it opens. A resize or a
   * scroll invalidates that measurement, and a menu left hanging in the wrong
   * place is worse than one that has closed — so it closes.
   *
   * The handler is a `useCallback` outside the effect rather than a closure
   * inside it: this project's lint rule rejects a `setState` written in an
   * effect body, and it cannot see that this one only ever runs from a browser
   * event.
   */
  const closeFlyout = useCallback(() => {
    setRailFlyout((open) => (open ? null : open));
  }, []);

  useEffect(() => {
    window.addEventListener("resize", closeFlyout);
    // Capture phase: the scroll that matters is the sidebar's own, and that
    // does not bubble to the window.
    window.addEventListener("scroll", closeFlyout, true);
    return () => {
      window.removeEventListener("resize", closeFlyout);
      window.removeEventListener("scroll", closeFlyout, true);
    };
  }, [closeFlyout]);

  if (!user) return <>{children}</>;

  if (isMobile) return <MobileShell role={role ?? undefined}>{children}</MobileShell>;

  const handleLogout = async () => {
    await logout();
    router.replace("/");
  };

  const menuItems = role === "admin"
    ? [
      { title: "Dashboard", icon: Home, path: "/home" },
      {
        title: "Lead Management", short: "Leads", icon: Target,
        subItems: [
          // Active / New / Closed are filter chips inside this one workspace now.
          { title: "Leads", path: "/admin/leads", icon: ListChecks },
          { title: "Campaigns", path: "/admin/leads/campaigns", icon: Megaphone }
        ]
      },
      {
        title: "Data Bank", short: "Data", icon: Database,
        subItems: [
          { title: "Sources", path: "/admin/data-bank", icon: FolderOpen }
        ]
      },
      {
        title: "Employee Hub", short: "Team", icon: Users,
        subItems: [
          { title: "Directory", path: "/admin/employees/directory", icon: IdCard },
          // §4 — activity per person over a date range, computed from the
          // records rather than kept as a separate statistic.
          { title: "Reports", path: "/admin/team/reports", icon: BarChart3 },
          { title: "Priority Settings", path: "/admin/employees/priority", icon: SlidersHorizontal }
        ]
      },
      {
        title: "Clients", icon: Users2,
        subItems: [
          { title: "Folders", path: "/admin/clients", icon: FolderOpen }
        ]
      },
      {
        title: "Financials", short: "Money", icon: DollarSign,
        subItems: [
          { title: "Closed Deals", path: "/admin/financials/deals", icon: Handshake },
          { title: "Profit Distribution", path: "/admin/financials/distribution", icon: PieChart },
          { title: "Salary / Payroll", path: "/admin/financials/payroll", icon: BadgeDollarSign },
          { title: "Office Expenses", path: "/admin/financials/expenses", icon: Receipt },
          { title: "Reports", path: "/admin/financials/reports", icon: FileBarChart }
        ]
      },
      {
        title: "Accounts", icon: Wallet,
        subItems: [
          { title: "Committee", path: "/admin/accounts/committee", icon: Users2 },
          { title: "Office Expenses", path: "/admin/accounts/office-expenses", icon: Building2 },
          { title: "Investment", path: "/admin/accounts/investment", icon: TrendingUp },
          { title: "Capital Investments", path: "/admin/accounts/capital-investments", icon: PiggyBank },
          { title: "Receivable", path: "/admin/accounts/receivable", icon: ReceiptText },
          { title: "Income Sheet", path: "/admin/accounts/income-sheet", icon: BarChart3 },
          { title: "Personal Expense", path: "/admin/accounts/personal-expense", icon: Wallet2 }
        ]
      },
      {
        title: "Attendance", short: "Time", icon: CalendarCheck,
        subItems: [
          { title: "Dashboard", path: "/admin/attendance", icon: LayoutDashboard },
          { title: "My Attendance", path: "/admin/attendance/me", icon: UserCheck },
          { title: "Calendar", path: "/admin/attendance/calendar", icon: CalendarDays },
          { title: "Leave Management", path: "/admin/attendance/leave", icon: CalendarClock },
          { title: "Attendance Reports", path: "/admin/attendance/reports", icon: FileBarChart },
          { title: "Late / Absence", path: "/admin/attendance/records", icon: AlertTriangle },
          { title: "Settings", path: "/admin/attendance/settings", icon: Settings }
        ]
      },
      { title: "Settings", icon: Settings, path: "/admin/settings" }
    ]
    : role === "subadmin"
      ? [
        // A sub admin's menu is the admin's, minus everything that is not
        // theirs: no company financials, no accounts, no roster management.
        // What is left is their team, their leads and their own money.
        { title: "Dashboard", icon: Home, path: "/home" },
        {
          title: "Lead Management", short: "Leads", icon: Target,
          subItems: [
            { title: "Team Leads", path: "/subadmin/leads", icon: ListChecks }
          ]
        },
        {
          title: "Data Bank", short: "Data", icon: Database,
          subItems: [
            { title: "My Sources", path: "/subadmin/data-bank", icon: FolderOpen }
          ]
        },
        {
          title: "My Team", short: "Team", icon: Users,
          subItems: [
            { title: "Team Performance", path: "/subadmin/team", icon: IdCard },
            { title: "Reports", path: "/subadmin/reports", icon: BarChart3 }
          ]
        },
        {
          title: "Clients", icon: Users2,
          subItems: [
            { title: "Folders", path: "/subadmin/clients", icon: FolderOpen }
          ]
        },
        {
          title: "Attendance", short: "Time", icon: CalendarCheck,
          subItems: [
            { title: "Dashboard", path: "/subadmin/attendance", icon: LayoutDashboard },
            { title: "My Attendance", path: "/subadmin/attendance/me", icon: UserCheck },
            { title: "Calendar", path: "/subadmin/attendance/calendar", icon: CalendarDays },
            { title: "Leave Management", path: "/subadmin/attendance/leave", icon: CalendarClock },
            { title: "Attendance Reports", path: "/subadmin/attendance/reports", icon: FileBarChart },
            { title: "Late / Absence", path: "/subadmin/attendance/records", icon: AlertTriangle },
            ...(isHr
              ? [{ title: "Settings", path: "/subadmin/attendance/settings", icon: Settings }]
              : [])
          ]
        },
        {
          title: "Earnings", short: "Money", icon: DollarSign,
          subItems: [
            { title: "My Earnings", path: "/subadmin/earnings", icon: Wallet },
            ...(isHr
              ? [
                  { title: "Salary / Payroll", path: "/subadmin/financials/payroll", icon: BadgeDollarSign },
                  { title: "Office Expenses", path: "/subadmin/financials/expenses", icon: Receipt }
                ]
              : [{ title: "My Salary", path: "/subadmin/salary", icon: BadgeDollarSign }])
          ]
        }
      ]
      : role === "employee"
      ? [
        { title: "Dashboard", icon: Home, path: "/home" },
        {
          title: "My Workspace", short: "Workspace", icon: Briefcase,
          subItems: [
            // Active / Closed / Pending are filter chips inside this workspace now.
            { title: "My Leads", path: "/employee/leads", icon: ListChecks }
          ]
        },
        {
          title: "Performance", short: "Stats", icon: Activity,
          subItems: [
            { title: "My Stats", path: "/employee/performance/stats", icon: BarChart3 },
            // §6 — their own report, in their own side panel. Scoped on the
            // server, so it can only ever be their row.
            { title: "My Report", path: "/employee/reports", icon: FileBarChart },
            // Their own commission on the deals they closed — nobody else's.
            { title: "My Earnings", path: "/employee/earnings", icon: Wallet },
            { title: "My Salary", path: "/employee/salary", icon: BadgeDollarSign }
          ]
        },
        {
          title: "Attendance", short: "Time", icon: CalendarCheck,
          subItems: [
            { title: "My Attendance", path: "/employee/attendance", icon: UserCheck },
            { title: "Calendar", path: "/employee/attendance/calendar", icon: CalendarDays },
            { title: "My Leave", path: "/employee/attendance/leave", icon: CalendarClock }
          ]
        }
      ]
      : [];

  const userName = user.email?.split('@')[0] || "User";
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <div className="flex h-screen bg-[#e9f1f0] overflow-hidden text-[#2b3a39]">
      {/* Sidebar overlay (mobile only) */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs transition-opacity md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        // `overflow-x-visible` while railed: the flyout panel has to escape the
        // 96px rail. The vertical scroll that the long Accounts list needs is
        // kept on the inner nav instead.
        className={`fixed inset-y-0 left-0 z-50 flex transform flex-col justify-between overflow-hidden border-r border-[#dceae8] bg-[#f5faf9] shadow-xl transition-all duration-300 ease-in-out md:relative md:translate-x-0 md:shadow-none ${
          isCollapsed ? "md:overflow-visible" : ""
        } ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"} ${
          isCollapsed ? "w-64 md:w-24" : "w-64"
        }`}
      >
        {/*
          `min-h-0` is load-bearing: a flex child defaults to `min-height:auto`,
          which refuses to shrink below its content — so without it the nav
          simply overflows the viewport and the last items are unreachable
          rather than scrolling. The scroll lives here rather than on the
          <aside> so the footer's Collapse and Sign out stay pinned.

          The collapsed rail keeps `overflow-visible` on desktop, because its
          flyout panel has to escape the 96px rail and a scroll container clips
          on both axes.
        */}
        <div
          className={`flex min-h-0 flex-1 flex-col ${
            isCollapsed ? "overflow-y-auto md:overflow-visible" : "overflow-y-auto"
          } overflow-x-hidden custom-scrollbar`}
        >
          {/* Logo Area */}
          <div
            className={`flex h-18 items-center border-b border-[#dceae8] bg-[#f5faf9] ${
              isCollapsed ? "justify-between px-6 md:justify-center md:px-3" : "justify-between px-6"
            }`}
          >
            <Link href="/home" className="shrink-0" aria-label="Go to dashboard">
              {/* The drawer is 256px wide even while the desktop rail is
                  collapsed, so it gets the full lockup. */}
              <BrandLogo compact={isCollapsed} className="hidden origin-left scale-95 md:block" />
              <BrandLogo compact={false} className="origin-left scale-95 md:hidden" />
            </Link>
            <button onClick={() => setSidebarOpen(false)} className="text-slate-400 hover:text-slate-700 md:hidden p-1">
              <X size={20} />
            </button>
          </div>

          {/*
            Navigation.

            Two renderings of the same `menuItems`. The rail is the design's
            resting state on desktop; the mobile drawer always shows the full
            labelled list, because a 96px rail inside a slide-over drawer would
            waste the space it just took over the screen.
          */}
          {isCollapsed ? (
            <>
              <nav ref={railRef} className="hidden md:flex flex-col items-center gap-2 px-2 py-4">
                {menuItems.map((item, idx) => {
                  const Icon = item.icon;
                  const children = item.subItems;
                  const isActive = children
                    ? children.some((s) => pathname === s.path || pathname.startsWith(s.path + "/"))
                    : pathname === item.path;
                  const flyoutOpen = railFlyout?.title === item.title;
                  // A 76px rail item fits one word; the full title stays on the
                  // expanded sidebar and as the flyout heading.
                  const railLabel = item.short ?? item.title;

                  const railClass = `flex w-[76px] flex-col items-center gap-1.5 rounded-lg px-1 py-2.5 text-[11px] leading-tight tracking-[0.2px] text-center transition-colors ${
                    isActive || flyoutOpen
                      ? "bg-[#dcecea] text-[#2f7d78]"
                      : "text-[#6c7d7b] hover:bg-[#e4f0ef] hover:text-[#2f7d78]"
                  }`;

                  if (!children && item.path) {
                    return (
                      <Link key={idx} href={item.path} className={railClass} aria-current={isActive ? "page" : undefined}>
                        {Icon && <Icon size={22} strokeWidth={1.5} />}
                        <span>{railLabel}</span>
                      </Link>
                    );
                  }

                  return (
                    <div key={idx} className="relative">
                      <button
                        onClick={(event) => {
                          if (flyoutOpen) {
                            setRailFlyout(null);
                            return;
                          }

                          const rect = event.currentTarget.getBoundingClientRect();
                          // Never above 12px, never so low that the panel has
                          // no room; whatever is left becomes its max height,
                          // and the list inside scrolls.
                          const floor = Math.max(12, window.innerHeight - 12 - MIN_FLYOUT_HEIGHT);
                          const top = Math.max(12, Math.min(rect.top, floor));

                          setRailFlyout({
                            title: item.title,
                            top,
                            left: rect.right + 8,
                            maxHeight: window.innerHeight - top - 16,
                          });
                        }}
                        className={railClass}
                        aria-expanded={flyoutOpen}
                        aria-haspopup="menu"
                      >
                        {Icon && <Icon size={22} strokeWidth={1.5} />}
                        <span>{railLabel}</span>
                      </button>

                      {flyoutOpen && children && railFlyout && (
                        <div
                          role="menu"
                          aria-label={item.title}
                          // `fixed`, so the panel is measured against the
                          // viewport rather than an ancestor that may clip or
                          // scroll. The header stays put and only the list
                          // scrolls, so the menu always says what it is.
                          style={{
                            position: "fixed",
                            top: railFlyout.top,
                            left: railFlyout.left,
                            maxHeight: railFlyout.maxHeight,
                          }}
                          className="z-50 flex w-56 flex-col rounded-xl border border-[#dceae8] bg-white shadow-[0_18px_40px_rgba(18,54,52,0.16)]"
                        >
                          <p className="shrink-0 rounded-t-xl border-b border-[#e6f1f0] bg-[#f5faf9] px-4 py-2.5 text-[11px] tracking-[0.8px] text-[#7e918f]">
                            {item.title.toUpperCase()}
                          </p>
                          <div className="custom-scrollbar flex min-h-0 flex-col overflow-y-auto p-1.5">
                            {children.map((sub, subIdx) => {
                              const subActive = pathname === sub.path || pathname.startsWith(sub.path + "/");
                              return (
                                <Link
                                  key={subIdx}
                                  href={sub.path}
                                  role="menuitem"
                                  onClick={() => setRailFlyout(null)}
                                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                                    subActive
                                      ? "bg-[#e8f5f3] text-[#2f7d78]"
                                      : "text-[#5b6d6b] hover:bg-[#f3faf9] hover:text-[#2f7d78]"
                                  }`}
                                >
                                  {sub.icon && <sub.icon size={15} className="shrink-0" />}
                                  <span>{sub.title}</span>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>

              <nav className="md:hidden p-4 space-y-1.5">
                <FullNavList
                  menuItems={menuItems}
                  pathname={pathname}
                  expandedCategory={expandedCategory}
                  setExpandedCategory={setExpandedCategory}
                />
              </nav>
            </>
          ) : (
            <nav className="p-4 space-y-1.5">
              <FullNavList
                menuItems={menuItems}
                pathname={pathname}
                expandedCategory={expandedCategory}
                setExpandedCategory={setExpandedCategory}
              />
            </nav>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="space-y-1 border-t border-[#dceae8] bg-[#f5faf9] p-3">
          {/*
            The expand/collapse toggle sits above sign-out so the destructive
            action stays last and separated, and it is the only control that
            changes the rail's width.
          */}
          <button
            onClick={() => {
              setCollapsed((c) => !c);
              setRailFlyout(null);
            }}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`hidden w-full items-center rounded-xl text-xs font-medium text-[#5b6d6b] transition-colors hover:bg-[#e4f0ef] hover:text-[#2f7d78] md:flex ${
              isCollapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3.5 py-2.5"
            }`}
          >
            {isCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!isCollapsed && "Collapse"}
          </button>

          <button
            onClick={handleLogout}
            title={isCollapsed ? "Sign out" : undefined}
            className={`flex w-full items-center rounded-xl text-xs font-medium text-[#c2483a] transition-colors hover:bg-[#fdeeeb] ${
              isCollapsed ? "justify-center px-0 py-2.5 md:justify-center" : "gap-3 px-3.5 py-2.5"
            }`}
          >
            <LogOut size={16} />
            <span className={isCollapsed ? "md:hidden" : ""}>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar */}
        <header className="relative flex h-18 shrink-0 items-center justify-between border-b border-slate-100/90 bg-white px-6 md:px-8 z-20">
          <div className="flex items-center gap-4 flex-1">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors md:hidden"
            >
              <Menu size={22} />
            </button>

            {/* Search Bar — jumps to the global lead/customer search (admin only) */}
            {role === "admin" && (
              <form
                className="relative max-w-xs w-full hidden sm:flex items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = topbarSearch.trim();
                  router.push(value ? `/admin/search?q=${encodeURIComponent(value)}` : "/admin/search");
                }}
              >
                <Search className="pointer-events-none absolute left-3.5 text-slate-400" size={16} />
                <input
                  type="text"
                  value={topbarSearch}
                  onChange={(e) => setTopbarSearch(e.target.value)}
                  placeholder="Search leads or customers..."
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-full border border-slate-200/80 bg-slate-50/50 text-slate-700 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition-all"
                />
              </form>
            )}
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <NotificationsPanel getIdToken={getIdToken} uid={user.uid} role={role ?? undefined} />

            {/* Profile Dropdown */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2.5 p-1 rounded-full hover:bg-slate-50 transition-colors"
                aria-label="User Profile"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-[#0b7e5e] to-[#15c58a] text-white font-bold text-xs shadow-sm">
                  {userInitial}
                </div>
                <span className="text-xs font-semibold text-slate-700 hidden sm:inline-block capitalize">
                  {userName}
                </span>
                <ChevronDown size={14} className="text-slate-400 hidden sm:inline-block" />
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-slate-100 bg-white shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-4 py-2.5 border-b border-slate-100">
                    <p className="text-xs font-semibold text-slate-900 truncate">{user.email}</p>
                    <p className="text-[11px] text-slate-400 capitalize">{role}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-rose-500 hover:bg-rose-50 transition-colors text-left"
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto relative z-10 p-6 md:p-8 custom-scrollbar">
          <div key={pathname} className="animate-page-transition min-h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
/* -------------------------------------------------------------------------- */
/* Full labelled navigation                                                   */
/* -------------------------------------------------------------------------- */

interface NavSubItem {
  title: string;
  path: string;
  icon?: typeof Home;
}

interface NavItem {
  title: string;
  icon?: typeof Home;
  path?: string;
  subItems?: NavSubItem[];
}

/**
 * The expanded sidebar list: top-level links plus accordion categories.
 *
 * Shared by the expanded desktop sidebar and the mobile drawer so the two can
 * never drift apart.
 */
function FullNavList({
  menuItems,
  pathname,
  expandedCategory,
  setExpandedCategory,
}: {
  menuItems: NavItem[];
  pathname: string;
  expandedCategory: string | null;
  setExpandedCategory: (v: string | null) => void;
}) {
  return (
    <>
      {menuItems.map((item, idx) => {
        if (item.path && !item.subItems) {
          const isActive = pathname === item.path;
          return (
            <Link
              key={idx}
              href={item.path}
              className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? "bg-[#dcecea] text-[#2f7d78]"
                  : "text-[#5b6d6b] hover:bg-[#f3faf9] hover:text-[#2f7d78]"
              }`}
            >
              <span className="flex items-center gap-3">
                {item.icon && <item.icon size={18} className={isActive ? "text-[#2f7d78]" : "text-[#7e918f]"} />}
                <span>{item.title}</span>
              </span>
              {isActive && <span className="h-5 w-1.5 rounded-full bg-[#4f9c99]" />}
            </Link>
          );
        }

        if (!item.subItems) return null;

        // Most specific match wins — "/admin/leads" is a prefix of
        // "/admin/leads/campaigns", so a plain startsWith lights up both rows.
        const matching = item.subItems.filter(
          (sub) => pathname === sub.path || pathname.startsWith(sub.path + "/")
        );
        const bestPath = matching.reduce((best, sub) => (sub.path.length > best.length ? sub.path : best), "");
        const hasActiveSubItem = matching.length > 0;
        const isExpanded = expandedCategory === item.title || (expandedCategory === null && hasActiveSubItem);

        return (
          <div key={idx} className="space-y-1">
            <button
              onClick={() => setExpandedCategory(isExpanded ? "" : item.title)}
              className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
                hasActiveSubItem
                  ? "bg-[#e8f5f3] text-[#2f7d78]"
                  : "text-[#5b6d6b] hover:bg-[#f3faf9] hover:text-[#2f7d78]"
              }`}
              aria-expanded={isExpanded}
            >
              <span className="flex items-center gap-3">
                {item.icon && <item.icon size={18} className={hasActiveSubItem ? "text-[#2f7d78]" : "text-[#7e918f]"} />}
                <span>{item.title}</span>
              </span>
              <ChevronDown
                size={15}
                className={`text-[#9aacaa] transition-transform duration-200 ${isExpanded ? "rotate-180 text-[#2f7d78]" : ""}`}
              />
            </button>

            <div
              className={`grid overflow-hidden transition-all duration-200 ease-in-out ${
                isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="ml-6 flex min-h-0 flex-col space-y-1 border-l border-[#e6f1f0] py-1 pl-3">
                {item.subItems.map((sub, subIdx) => {
                  const isSubActive = sub.path === bestPath;
                  return (
                    <Link
                      key={subIdx}
                      href={sub.path}
                      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        isSubActive
                          ? "bg-[#e8f5f3] text-[#2f7d78]"
                          : "text-[#7e918f] hover:bg-[#f3faf9] hover:text-[#2f7d78]"
                      }`}
                    >
                      {sub.icon && <sub.icon size={14} className={isSubActive ? "text-[#2f7d78]" : "text-[#9aacaa]"} />}
                      <span>{sub.title}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
