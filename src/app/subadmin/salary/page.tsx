"use client";

import { MySalaryView } from "@/components/finance/MySalaryView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * A manager's own salary. Managers are paid too, and this is the one salary
 * screen they can always reach — their own — regardless of whether the admin
 * has granted them company-wide salary access.
 */
export default function Page() {
  useProtectedRoute(["subadmin"]);
  return <MySalaryView />;
}
