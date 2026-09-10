"use client";

import { AccountsView } from "@/components/accounts/AccountsView";
import { MobileAccountsHub } from "@/components/mobile/MobileAccountsHub";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * The Accounts dashboard.
 *
 * **Two products, not one reflowed.** The desktop gets the dashboard — every
 * account, every balance, recent movement side by side. The phone gets a list
 * you tap into, because that is what the bottom bar's Accounts slot opens and a
 * dashboard squeezed to 390px is a worse answer to "what is in each account"
 * than a list of accounts.
 */
export default function AccountsPage() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileAccountsHub /> : <AccountsView />;
}
