"use client";

import { TeamCalendarView } from "@/components/attendance/TeamCalendarView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * The attendance calendar (§3) for a manager's team.
 *
 * Both Admin and Sub-Admin can view and adjust attendance directly from the calendar.
 */
export default function Page() {
  useProtectedRoute(["subadmin"]);
  return <TeamCalendarView canAdjust />;
}
