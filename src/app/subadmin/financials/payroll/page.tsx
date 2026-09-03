"use client";

import { PayrollView } from "@/components/finance/PayrollView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Salary / Payroll for an HR manager, or a manager the admin has granted
 * salary access.
 *
 * No client-side gate here beyond the role: whether this particular manager may
 * see salary figures is a field on their profile, which only the server can
 * read. It refuses with a plain sentence rather than an empty screen.
 */
export default function Page() {
  useProtectedRoute(["subadmin"]);
  return <PayrollView />;
}
