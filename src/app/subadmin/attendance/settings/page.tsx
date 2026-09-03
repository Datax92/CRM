"use client";

import { AttendanceSettingsView } from "@/components/attendance/AttendanceSettingsView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { A, EmptyState } from "@/components/attendance/attendanceChrome";

/**
 * Attendance settings for an **HR** manager (§13).
 *
 * A Sales manager who reaches this URL is told plainly rather than shown a
 * form that will refuse every save. The Server Action is the real gate; this
 * is only about not wasting somebody's time.
 */
export default function Page() {
  useProtectedRoute(["subadmin"]);
  const { isHr } = useAuth();

  if (!isHr) {
    return (
      <div style={{ padding: 4, color: A.ink }}>
        <EmptyState>
          Attendance rules are set by the admin and by HR. Ask them to change a time, a deduction or
          the office network.
        </EmptyState>
      </div>
    );
  }

  return <AttendanceSettingsView />;
}
