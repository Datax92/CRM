"use client";

import { MyAttendanceView } from "@/components/attendance/MyAttendanceView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * An employee's calendar is their own attendance screen — the calendar is on
 * it, with the month's figures and the leave beside it. A second page holding
 * only the grid would be the same data with less of it.
 */
export default function Page() {
  useProtectedRoute(["employee"]);
  return <MyAttendanceView heading="My Calendar" />;
}
