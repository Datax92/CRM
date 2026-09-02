import { redirect } from "next/navigation";

/**
 * Retired route — My Closed Leads is a filter chip on the unified employee
 * workspace now. Kept as a redirect so bookmarks and notification deep links
 * still land somewhere sensible.
 */
export default function LegacyEmployeeClosedPage() {
  redirect("/employee/leads?filter=closed");
}
