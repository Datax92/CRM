"use client";

import { usePathname } from "next/navigation";
import { MobileBackBar } from "@/components/mobile/MobileBackBar";

/**
 * Every Accounts page, with a way back out of it on the phone.
 *
 * **One layout rather than a control on each screen**, so a page added next
 * month cannot forget it. The destination is one level up, not "the previous
 * page": a committee opened from the hub and the same committee opened from a
 * transaction row should both go back to the accounts list, which is where the
 * reader's model of the section says they are.
 */
export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const atRoot = pathname === "/admin/accounts";

  // A ledger statement and one investment sit two levels down, so their Back
  // names the list they came from rather than the section root.
  const up = pathname.startsWith("/admin/accounts/capital-investments/")
    ? { label: "All investments", href: "/admin/accounts/capital-investments" }
    : { label: "Accounts", href: "/admin/accounts" };

  return (
    <>
      {!atRoot && <MobileBackBar label={up.label} href={up.href} />}
      {children}
    </>
  );
}
