"use client";

import type { ReactNode } from "react";
import { AttendanceShell } from "@/components/attendance/AttendanceShell";

/**
 * An employee's attendance.
 *
 * Three screens rather than seven, and no management tabs — but the same
 * frame, so it does not read as a different part of the product.
 */
const TABS = [
  { label: "My Attendance", path: "/employee/attendance" },
  { label: "Calendar", path: "/employee/attendance/calendar" },
  { label: "My Leave", path: "/employee/attendance/leave" },
];

export default function AttendanceLayout({ children }: { children: ReactNode }) {
  return (
    <AttendanceShell tabs={TABS} home="/employee/attendance" fallbackTitle="My Attendance">
      {children}
    </AttendanceShell>
  );
}
