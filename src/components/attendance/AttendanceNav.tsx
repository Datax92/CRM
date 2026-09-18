"use client";

/**
 * The attendance module's own tab strip.
 *
 * The desktop sidebar already lists these, so on a wide screen this is a
 * convenience. **On a phone it is the only way between them** — the five-slot
 * tab bar has no room for a sixth destination, and burying six screens behind
 * the account sheet would make the module unusable exactly where attendance is
 * most used, which is on a phone at nine in the morning.
 *
 * It scrolls horizontally rather than wrapping: a strip that reflows into three
 * ragged rows at 390px pushes the actual screen below the fold.
 *
 * The segmented pill is `Attendance Calendar.dc.html`'s (2026-09-18): a
 * #dceae8 track with the current tab lifted onto white.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface AttendanceTab {
  label: string;
  path: string;
}

export function attendanceTabs(
  basePath: string,
  options: { canManage: boolean; canSetPolicy: boolean }
): AttendanceTab[] {
  if (!options.canManage) {
    return [{ label: "My Attendance", path: basePath }];
  }

  return [
    { label: "Dashboard", path: basePath },
    { label: "Mine", path: `${basePath}/me` },
    { label: "Calendar", path: `${basePath}/calendar` },
    { label: "Leave", path: `${basePath}/leave` },
    { label: "Reports", path: `${basePath}/reports` },
    { label: "Late / Absence", path: `${basePath}/records` },
    ...(options.canSetPolicy ? [{ label: "Settings", path: `${basePath}/settings` }] : []),
  ];
}

export function AttendanceNav({ tabs }: { tabs: AttendanceTab[] }) {
  const pathname = usePathname();
  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label="Attendance"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: 999,
        background: "#dceae8",
        maxWidth: "100%",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {tabs.map((tab) => {
        const active = pathname === tab.path;
        return (
          <Link
            key={tab.path}
            href={tab.path}
            aria-current={active ? "page" : undefined}
            style={{
              flexShrink: 0,
              padding: "9px 20px",
              borderRadius: 999,
              fontSize: 13.5,
              fontWeight: 700,
              whiteSpace: "nowrap",
              textDecoration: "none",
              color: active ? "#2f7d78" : "#5b6d6b",
              background: active ? "#fff" : "transparent",
              boxShadow: active ? "0 1px 3px rgba(31,92,88,0.14)" : "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
