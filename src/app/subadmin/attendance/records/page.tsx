"use client";

import { LateAbsenceView } from "@/components/attendance/LateAbsenceView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useAuth } from "@/context/AuthContext";

/**
 * Late and absence records (§5), with the deduction each late produced (§12).
 *
 * Closing a month is HR's, not a Sales manager's — it fixes what people are
 * paid. A Sales manager reads their team's record and the figures behind it.
 */
export default function Page() {
  useProtectedRoute(["subadmin"]);
  const { isHr } = useAuth();
  return <LateAbsenceView canFinalize={isHr} />;
}
