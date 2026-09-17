"use client";

/**
 * A manager's own Facebook leads — offers waiting on them when an admin has
 * put them in the rotation, and the ones they took. Same screen as the
 * employee's, so the two cannot drift.
 */

import { MetaLeadsView } from "@/components/leads/MetaLeadsView";

export default function SubAdminMetaLeadsPage() {
  return <MetaLeadsView />;
}
