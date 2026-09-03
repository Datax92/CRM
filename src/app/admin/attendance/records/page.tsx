"use client";

import { LateAbsenceView } from "@/components/attendance/LateAbsenceView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Late and absence records (§5), with the deduction each late produced (§12).
 */
export default function Page() {
  useProtectedRoute(["admin"]);
  return <LateAbsenceView canFinalize />;
}
