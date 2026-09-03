"use client";

import type { ReactNode } from "react";
import { AttendanceShell } from "@/components/attendance/AttendanceShell";
import { attendanceTabs } from "@/components/attendance/AttendanceNav";
import { useAuth } from "@/context/AuthContext";

/**
 * A manager's attendance module.
 *
 * **Settings is offered to HR only.** A Sales manager shown the tab would find
 * a screen that refuses every save — the server refuses them either way, so
 * the tab is absent rather than present and broken.
 */
export default function AttendanceLayout({ children }: { children: ReactNode }) {
  const { isHr } = useAuth();

  return (
    <AttendanceShell
      tabs={attendanceTabs("/subadmin/attendance", { canManage: true, canSetPolicy: isHr })}
      home="/subadmin/attendance"
      fallbackTitle="Attendance"
    >
      {children}
    </AttendanceShell>
  );
}
