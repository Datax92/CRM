"use client";

import { TeamReportView } from "@/components/reports/TeamReportView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuietHours } from "@/hooks/useQuietHours";


/**
 * Reports (§4–§6).
 *
 * One view, three routes — the scope is decided on the server from the verified
 * token, so each role simply lands on its own copy rather than the screen
 * deciding what to hide.
 */
export default function ReportsPage() {
  useProtectedRoute(["admin"]);
  const quietHours = useQuietHours();
  const router = useRouter();
  // Out of use during quiet hours (owner, 2026-09-25): a direct link goes to the team.
  useEffect(() => {
    if (quietHours) router.replace("/admin/employees/directory");
  }, [quietHours, router]);
  if (quietHours) return null;
  return <TeamReportView />;
}
