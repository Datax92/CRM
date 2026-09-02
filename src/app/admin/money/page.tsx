"use client";

import { MoneyHub } from "@/components/mobile/MoneyHub";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/**
 * Money — the phone bottom bar's financial section.
 *
 * One hub component, three thin routes, because the destinations differ by role
 * and the route a person lands on should already be theirs. On a desktop the
 * same cards render inside the normal shell; the bar that leads here is a phone
 * affordance, not the page's only way in.
 */
export default function MoneyPage() {
  useProtectedRoute(["admin"]);
  return <MoneyHub />;
}
