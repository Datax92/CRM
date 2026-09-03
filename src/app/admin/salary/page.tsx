"use client";

import { MySalaryView } from "@/components/finance/MySalaryView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * The admin's own payslips. They are on the payroll like everybody else, and
 * the payroll screen shows the company rather than them.
 */
export default function Page() {
  useProtectedRoute(["admin"]);
  return <MySalaryView />;
}
