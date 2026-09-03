"use client";

import { PayrollView } from "@/components/finance/PayrollView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Salary / Payroll.
 *
 * The scope comes from the verified token on the server — the admin and HR
 * reach it, a manager only if the admin has granted them salary access, and an
 * employee never. The route guard is the outer layer; the Server Actions are
 * the one that actually decides.
 */
export default function Page() {
  useProtectedRoute(["admin"]);
  return <PayrollView />;
}
