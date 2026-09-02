import { redirect } from "next/navigation";

/**
 * Retired route — Pending Follow-ups is a filter chip on the unified employee
 * workspace now. Kept as a redirect so bookmarks and notification deep links
 * still land somewhere sensible.
 */
export default function LegacyEmployeePendingPage() {
  redirect("/employee/leads?filter=pending");
}
