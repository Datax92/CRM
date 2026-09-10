"use client";

import { use } from "react";
import { CapitalInvestmentView } from "@/components/accounts/CapitalInvestmentView";

/** One venture: its contributions, its spendings, and what funded each. */
export default function CapitalInvestmentPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  return <CapitalInvestmentView accountId={accountId} />;
}
