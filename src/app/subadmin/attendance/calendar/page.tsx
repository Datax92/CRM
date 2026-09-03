"use client";

import { TeamCalendarView } from "@/components/attendance/TeamCalendarView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useAuth } from "@/context/AuthContext";

/**
 * The attendance calendar (§3) for a manager's team.
 *
 * A **Sales** manager reads it; an **HR** manager corrects days on it. The
 * server enforces that either way — this only decides whether the correction
 * form is offered, because a control that is always refused is worse than no
 * control at all.
 */
export default function Page() {
  useProtectedRoute(["subadmin"]);
  const { isHr } = useAuth();
  return <TeamCalendarView canAdjust={isHr} />;
}
