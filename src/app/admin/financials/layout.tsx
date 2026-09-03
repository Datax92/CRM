"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MobileSubHeader } from "@/components/mobile/MobileSubHeader";
import { useIsMobile } from "@/hooks/useIsMobile";

const TITLES: Record<string, string> = {
  "/admin/financials/deals": "Closed Deals",
  "/admin/financials/distribution": "Profit Distribution",
  "/admin/financials/payroll": "Salary / Payroll",
  "/admin/financials/expenses": "Office Expenses",
  "/admin/financials/reports": "Financial Reports",
};

/**
 * The money screens' phone header.
 *
 * None of these is one of the five the tab bar reaches — they are opened from
 * the Money hub or the account sheet — so without this there is no way back
 * and no way anywhere else. `home` is the Money hub, which is where somebody
 * deep-linking in should land when there is no history behind them.
 */
export default function MoneyLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const pathname = usePathname();

  if (!isMobile) return <>{children}</>;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <MobileSubHeader
        eyebrow="Money"
        title={TITLES[pathname] ?? "Money"}
        home="/admin/money"
      />
      {children}
    </div>
  );
}
