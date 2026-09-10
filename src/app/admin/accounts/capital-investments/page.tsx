"use client";

import { AccountKindView } from "@/components/accounts/AccountKindView";

/**
 * Capital Investment — the same received/spent statement per named pot, exactly
 * as the CAPITAL INVESTMENT sheet stacks "CAR INVESTMENT", "STATE LIFE LOAN"
 * and the rest.
 */
export default function CapitalInvestmentsPage() {
  return (
    <AccountKindView
      kind="INVESTMENT"
      title="Capital Investment"
      blurb="Each investment is an account: what was put in, what it has been spent on, and what is left. Paying anything from one records itself here."
      addLabel="New investment"
    />
  );
}
