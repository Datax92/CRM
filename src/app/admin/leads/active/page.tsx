import { redirect } from "next/navigation";

/**
 * Retired route — Active Leads Pipeline now lives as a filter chip on the unified leads
 * workspace. Kept as a redirect so existing bookmarks, notification deep links
 * and browser history all still land somewhere sensible.
 */
export default function LegacyActiveLeadsPage() {
  redirect("/admin/leads?filter=active");
}
