"use client";

import { TeamReportView } from "@/components/reports/TeamReportView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Reports (§4–§6).
 *
 * One view, three routes — the scope is decided on the server from the verified
 * token, so each role simply lands on its own copy rather than the screen
 * deciding what to hide.
 */
export default function ReportsPage() {
  useProtectedRoute(["subadmin"]);
  return <TeamReportView />;
}
