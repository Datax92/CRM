"use client";

import type { ReactNode } from "react";
import { AttendanceShell } from "@/components/attendance/AttendanceShell";
import { attendanceTabs } from "@/components/attendance/AttendanceNav";

/** The admin's attendance module — every screen, one frame. */
export default function AttendanceLayout({ children }: { children: ReactNode }) {
  return (
    <AttendanceShell
      tabs={attendanceTabs("/admin/attendance", { canManage: true, canSetPolicy: true })}
      home="/admin/attendance"
      fallbackTitle="Attendance"
    >
      {children}
    </AttendanceShell>
  );
}
