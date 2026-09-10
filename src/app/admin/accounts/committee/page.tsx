"use client";

import { AccountKindView } from "@/components/accounts/AccountKindView";

/**
 * Committee — one card per committee, opening to the received/spent statement
 * the owner's sheet draws by hand.
 */
export default function CommitteePage() {
  return (
    <AccountKindView
      kind="COMMITTEE"
      title="Committee"
      blurb="A committee is a pot you spend out of: the amount that came in, what has gone, and what is left. Anything paid from a committee anywhere in the CRM lands in its spendings by itself."
      addLabel="New committee"
    />
  );
}
