"use client";

import { Suspense } from "react";
import { LeadsWorkspace } from "@/components/leads/LeadsWorkspace";
import { FullPageSpinner } from "@/components/admin/AdminShared";

/**
 * The admin leads workspace — the whole pipeline, with intake triage,
 * lead creation and reassignment.
 *
 * `LeadsWorkspace` reads `?filter=` through `useSearchParams`, which Next
 * requires to sit inside a Suspense boundary.
 */
export default function AdminLeadsPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <LeadsWorkspace workspaceRole="admin" basePath="/admin/leads" />
    </Suspense>
  );
}
