"use client";

import { LeaveManagementView } from "@/components/attendance/LeaveManagementView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Leave management (§7). A manager decides on their own team's requests; an
 * admin or HR sees every request in the company.
 */
export default function Page() {
  useProtectedRoute(["subadmin"]);
  return <LeaveManagementView />;
}
