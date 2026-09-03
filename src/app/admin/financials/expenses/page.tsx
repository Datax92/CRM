"use client";

import { OfficeExpensesView } from "@/components/finance/OfficeExpensesView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Office Expenses.
 *
 * **Admin and HR only** — the brief is firm about it, and it is enforced in
 * three places: this guard, every Server Action, and the Security Rule on the
 * collection. A manager or an employee is refused the read outright rather
 * than shown an empty ledger.
 */
export default function Page() {
  useProtectedRoute(["admin"]);
  return <OfficeExpensesView isAdmin />;
}
