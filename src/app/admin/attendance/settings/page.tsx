"use client";

import { AttendanceSettingsView } from "@/components/attendance/AttendanceSettingsView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Attendance settings (§2, §4, §5, §6). Admin and HR only — §13 puts the
 * policy with the people who own it, and the Server Action refuses anyone
 * else regardless of how they reached the page.
 */
export default function Page() {
  useProtectedRoute(["admin"]);
  return <AttendanceSettingsView />;
}
