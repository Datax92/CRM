"use client";

import { MyAttendanceView } from "@/components/attendance/MyAttendanceView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * An employee's leave lives on their own attendance screen: the balance, the
 * request form and every request they have made are all there, beside the days
 * the leave applies to.
 */
export default function Page() {
  useProtectedRoute(["employee"]);
  return <MyAttendanceView heading="My Leave" />;
}
