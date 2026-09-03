"use client";

import { MyAttendanceView } from "@/components/attendance/MyAttendanceView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * A person's own attendance (§10) — the same screen for every role, because
 * everybody turns up to work.
 */
export default function Page() {
  useProtectedRoute(["admin"]);
  return <MyAttendanceView />;
}
