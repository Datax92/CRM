"use client";

import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { EarningsPanel } from "@/components/financials/EarningsPanel";

/**
 * A sub admin's earnings — their own and their team's.
 *
 * One query answers both: `finalizeProfitDistribution` stamps a sub admin's own
 * payout row with their own uid in `subAdminUid`, so `scope="team"` returns
 * their share alongside their employees'.
 */
export default function SubAdminEarningsPage() {
  const { user, role } = useAuth();
  useProtectedRoute(["subadmin"]);
  return <EarningsPanel uid={user?.uid} scope="team" enabled={role === "subadmin"} />;
}
