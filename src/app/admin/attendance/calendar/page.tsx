"use client";

import { TeamCalendarView } from "@/components/attendance/TeamCalendarView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * The attendance calendar (§3). Correcting a day is HR's and the admin's, so
 * `canAdjust` follows the role rather than being offered and then refused.
 */
export default function Page() {
  useProtectedRoute(["admin"]);
  return <TeamCalendarView canAdjust />;
}
