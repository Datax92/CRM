"use client";

/**
 * The attendance module's shell.
 *
 * **The full-bleed treatment lives here, not on the pages.** The dashboard
 * used to cancel the `<main>` padding with its own negative margin, which
 * pulled it *up over the tab strip this layout renders above it* — the strip
 * was still there, just underneath the hero card. Owning the bleed at the
 * layout level means a page can never overlap its own navigation again, and a
 * new attendance screen inherits the right frame without knowing about any of
 * this.
 *
 * On a phone it also carries the header — back, the screen's own name, and the
 * account button — because none of these screens is one of the five the tab
 * bar reaches, so without it there is no way back and no way anywhere else.
 */

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AttendanceNav, type AttendanceTab } from "@/components/attendance/AttendanceNav";
import { MobileSubHeader } from "@/components/mobile/MobileSubHeader";
import { useIsMobile } from "@/hooks/useIsMobile";
import { E } from "@/components/employees/directoryChrome";

export function AttendanceShell({
  tabs,
  home,
  fallbackTitle,
  children,
}: {
  tabs: AttendanceTab[];
  home: string;
  fallbackTitle: string;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const current = tabs.find((tab) => tab.path === pathname);

  return (
    <div
      style={{
        fontFamily: E.font,
        letterSpacing: E.tracking,
        background: E.page,
        color: E.ink,
        minHeight: "100%",
        // Cancels the <main> padding so the module owns the full frame. Every
        // child then renders in normal flow and cannot climb over the strip.
        margin: isMobile ? "-18px -16px" : "-24px -28px",
        padding: isMobile ? "0 16px 26px" : "22px 28px 32px",
      }}
    >
      {isMobile && (
        <MobileSubHeader
          eyebrow="Attendance"
          title={current?.label ?? fallbackTitle}
          home={home}
        />
      )}

      {/* `position: relative` and a stacking context above the content, so a
          card with its own shadow can never paint over the strip. */}
      <div style={{ position: "relative", zIndex: 1, marginBottom: 14 }}>
        <AttendanceNav tabs={tabs} />
      </div>

      {children}
    </div>
  );
}
