"use client";

/**
 * The phone frame: a full-height column whose only scrolling region is the
 * page body, with the tab bar pinned beneath it.
 *
 * `100dvh` rather than `100vh` — on mobile Safari and Chrome `vh` is the
 * *largest* viewport, so a `100vh` column sits partly behind the URL bar and
 * the tab bar ends up off-screen until the user scrolls. `dvh` tracks the
 * visible height. A `vh` fallback is declared first for anything older.
 *
 * Each page supplies its own teal header, because the two designs have
 * different ones (greeting + attendance strip vs. title + search). The shell
 * owns only what they share: the ground colour, the scroll containment and
 * the tab bar.
 *
 * The centre action is contextual, so pages declare it through this context
 * rather than the shell guessing from the route — the dashboard needs live
 * lead data to know whether there is anything to dial, and the shell should
 * not open a second listener for that.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { M } from "./mobileChrome";
import { MobileTabBar, type CentreAction } from "./MobileTabBar";

const CentreContext = createContext<((action: CentreAction) => void) | null>(null);

const MOBILE_KEYFRAMES = `
@keyframes mob-rise { from { opacity: 0; transform: translate3d(0, 10px, 0); } to { opacity: 1; transform: none; } }
@keyframes mob-sheet { from { transform: translate3d(0, 100%, 0); } to { transform: none; } }
@keyframes mob-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes mob-slide-in { from { opacity: 0; transform: translate3d(24px, 0, 0); } to { opacity: 1; transform: none; } }
.mob-rise { animation: mob-rise 300ms cubic-bezier(0.22,0.61,0.36,1) both; }
.mob-sheet { animation: mob-sheet 280ms cubic-bezier(0.22,0.61,0.36,1) both; will-change: transform; }
.mob-fade { animation: mob-fade 200ms ease both; }
.mob-slide-in { animation: mob-slide-in 260ms cubic-bezier(0.22,0.61,0.36,1) both; will-change: transform, opacity; }
.mob-press { transition: transform 120ms ease; }
.mob-press:active { transform: scale(0.975); }
/* 100vh is the *largest* viewport on mobile browsers, so a vh-tall column
   hides its footer behind the URL bar. dvh tracks the visible height; the vh
   line stays as the fallback for anything that does not know dvh. */
.mob-shell { height: 100vh; height: 100dvh; }
@media (prefers-reduced-motion: reduce) {
  .mob-rise, .mob-sheet, .mob-fade, .mob-slide-in { animation: none !important; }
  .mob-press { transition: none !important; }
  .mob-press:active { transform: none !important; }
}
`;

/**
 * Declare the raised centre button for the current screen.
 *
 * `action` is depended on by identity, so callers pass a memoised value —
 * an inline object would re-register on every render.
 */
export function useMobileCentre(action: CentreAction): void {
  const setCentre = useContext(CentreContext);
  useEffect(() => {
    if (!setCentre) return;
    setCentre(action);
    return () => setCentre(null);
  }, [setCentre, action]);
}

/**
 * Routes that draw their own teal header and scrolling body — the two screens
 * the design files cover. Everything else is an as-yet-undesigned desktop page
 * shown inside the phone frame, so the shell gives it a padded scroll region
 * of its own rather than letting it run under the tab bar.
 *
 * Decided from the path rather than announced by the page through context: a
 * context signal arrives in an effect, which would show one frame of the wrong
 * layout on every navigation.
 */
function hasOwnChrome(pathname: string): boolean {
  return (
    pathname === "/home" ||
    pathname === "/admin/leads" ||
    pathname === "/subadmin/leads" ||
    pathname === "/employee/leads" ||
    pathname === "/admin/employees/directory" ||
    // The Money hubs draw their own teal header, so the shell must not add its
    // padded scroll wrapper on top of one.
    pathname === "/admin/money" ||
    pathname === "/subadmin/money" ||
    pathname === "/employee/money" ||
    // The Data Bank and any one folder inside it. `startsWith` rather than an
    // equality per route, because the folder id is in the path.
    pathname === "/admin/data-bank" ||
    pathname.startsWith("/admin/data-bank/") ||
    pathname === "/subadmin/data-bank" ||
    pathname.startsWith("/subadmin/data-bank/")
  );
}

export function MobileShell({ role, children }: { role: string | undefined; children: ReactNode }) {
  const pathname = usePathname();
  const bare = hasOwnChrome(pathname);
  const [centre, setCentre] = useState<CentreAction>(null);
  // Stable identity, so `useMobileCentre`'s effect does not re-run whenever
  // the shell re-renders for an unrelated reason.
  const contextValue = useMemo(() => setCentre, []);

  return (
    <CentreContext.Provider value={contextValue}>
      {/*
        Keyframes cannot be expressed as inline styles, and a rule in
        `globals.css` is exactly the build artefact that has silently gone
        missing twice on this project. Shipping them in the tree means the
        animation either arrives with the component or not at all.

        Every one is transform/opacity only — no width, height, top or filter —
        so they run on the compositor and stay smooth on a low-end phone. All
        of them collapse to nothing under `prefers-reduced-motion`.
      */}
      <style>{MOBILE_KEYFRAMES}</style>
      <div
        className="mob-shell"
        style={{
          display: "flex",
          flexDirection: "column",
          background: M.page,
          overflow: "hidden",
          fontFamily: "var(--font-dashboard), 'Plus Jakarta Sans', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            ...(bare
              ? null
              : {
                  overflowY: "auto",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                  padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px 20px",
                }),
          }}
        >
          {children}
        </div>
        <MobileTabBar role={role} centre={centre} />
      </div>
    </CentreContext.Provider>
  );
}

/**
 * The scrolling body every phone screen puts under its header.
 *
 * `WebkitOverflowScrolling` keeps momentum scrolling on older iOS, and
 * `overscrollBehavior: contain` stops a flick at the end of the list from
 * dragging the whole page (and, on Chrome Android, from triggering
 * pull-to-refresh mid-scroll).
 */
export function MobileBody({ children, padding = "18px 18px 26px" }: { children: ReactNode; padding?: string }) {
  return (
    <div
      style={{
        minHeight: 0,
        flex: 1,
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        padding,
      }}
    >
      {children}
    </div>
  );
}
