"use client";

import { use } from "react";
import { AccountsView } from "@/components/accounts/AccountsView";

/**
 * One account's statement, in the workbook's received/spent layout.
 *
 * This is the page a Committee or a Capital Investment opens to — they are
 * accounts, so they need no module of their own.
 */
export default function AccountLedgerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  return <AccountsView accountId={accountId} />;
}
