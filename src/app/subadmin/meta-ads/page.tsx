"use client";

/**
 * A manager's Meta Ads — every Facebook lead their team holds, grouped by
 * campaign in the admin's layout. Built from the team's leads rather than the
 * admin's folders, which a manager cannot read; see `TeamMetaAdsView`.
 */

import { TeamMetaAdsView } from "@/components/dataBank/TeamMetaAdsView";

export default function SubAdminMetaAdsPage() {
  return <TeamMetaAdsView />;
}
