"use client";

import { AttendanceDashboard } from "@/components/attendance/AttendanceDashboard";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Attendance dashboard (§1).
 *
 * One view, three routes. The scope comes from the verified token on the
 * server — an admin and an HR manager see the company, a Sales manager sees
 * their own team — so the screen never decides who may be looked at.
 */
export default function Page() {
  useProtectedRoute(["subadmin"]);
  return <AttendanceDashboard basePath="/subadmin/attendance" />;
}
