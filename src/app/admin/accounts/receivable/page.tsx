"use client";

import { ReceivablesSheetView } from "@/components/accounts/ReceivablesSheetView";

/**
 * Receivables and Payables. The old single list (title, size, amount) is
 * replaced by the owner's two sheets; its rows are brought in from the screen
 * itself, and the old collection is kept.
 */
export default function ReceivablesPage() {
  return <ReceivablesSheetView />;
}
