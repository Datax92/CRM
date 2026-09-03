"use client";

import { MySalaryView } from "@/components/finance/MySalaryView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * An employee's own salary and payslips. Scoped to them on the server — asking
 * for anybody else's uid is refused, not filtered.
 */
export default function Page() {
  useProtectedRoute(["employee"]);
  return <MySalaryView />;
}
