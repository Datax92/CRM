import { redirect } from "next/navigation";

/**
 * Retired route — Closed Leads Archive now lives as a filter chip on the unified leads
 * workspace. Kept as a redirect so existing bookmarks, notification deep links
 * and browser history all still land somewhere sensible.
 */
export default function LegacyClosedLeadsPage() {
  redirect("/admin/leads?filter=closed");
}
