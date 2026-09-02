"use client";

import { Suspense } from "react";
import { LeadsWorkspace } from "@/components/leads/LeadsWorkspace";
import { FullPageSpinner } from "@/components/admin/AdminShared";

/**
 * A sub admin's pipeline — the same workspace the admin uses, scoped to their
 * own team by `useLeads` and by the Security Rule behind it, not by anything
 * this page does.
 */
export default function SubAdminLeadsPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <LeadsWorkspace workspaceRole="subadmin" basePath="/subadmin/leads" />
    </Suspense>
  );
}
