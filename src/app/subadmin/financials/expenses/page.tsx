"use client";

import { OfficeExpensesView } from "@/components/finance/OfficeExpensesView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { EmptyState } from "@/components/attendance/attendanceChrome";

/**
 * Office Expenses for HR.
 *
 * A Sales manager who reaches this URL is told plainly rather than shown a
 * screen whose every read will be refused. The Security Rule is the real gate;
 * this is about not wasting somebody's time.
 */
export default function Page() {
  useProtectedRoute(["subadmin"]);
  const { isHr } = useAuth();

  if (!isHr) {
    return (
      <EmptyState>
        Office expenses are kept between the admin and HR. Your own earnings and your team&apos;s
        are under Money.
      </EmptyState>
    );
  }

  return <OfficeExpensesView isAdmin={false} />;
}
