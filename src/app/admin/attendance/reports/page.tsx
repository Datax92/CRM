"use client";

import { AttendanceReportsView } from "@/components/attendance/AttendanceReportsView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Attendance reports (§9), scoped on the server to whoever is asking.
 */
export default function Page() {
  useProtectedRoute(["admin"]);
  return <AttendanceReportsView />;
}
