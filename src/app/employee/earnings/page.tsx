"use client";

import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { EarningsPanel } from "@/components/financials/EarningsPanel";

/** An employee's own commission on the deals they closed (§22). */
export default function EmployeeEarningsPage() {
  const { user, role } = useAuth();
  useProtectedRoute(["employee"]);
  return <EarningsPanel uid={user?.uid} scope="self" enabled={role === "employee"} />;
}
