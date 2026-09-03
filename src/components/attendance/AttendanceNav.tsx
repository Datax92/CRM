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
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { A } from "./attendanceChrome";

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
        display: "flex",
        gap: 6,
        overflowX: "auto",
        paddingBottom: 4,
        marginBottom: 4,
        WebkitOverflowScrolling: "touch",
      }}
    >
      {tabs.map((tab) => {
        const active = pathname === tab.path;
        return (
          <Link
            key={tab.path}
            href={tab.path}
            style={{
              flexShrink: 0,
              borderRadius: 999,
              border: `1px solid ${active ? A.teal : A.line}`,
              background: active ? A.tealSoft : A.surface,
              color: active ? A.teal : A.muted,
              padding: "7px 14px",
              fontSize: 12.5,
              fontWeight: 700,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
