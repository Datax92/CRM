"use client";

import { Suspense } from "react";
import { LeadsWorkspace } from "@/components/leads/LeadsWorkspace";
import { FullPageSpinner } from "@/components/admin/AdminShared";

/**
 * An employee's own pipeline — the same workspace as the admin console, scoped
 * to leads assigned to them and without pipeline administration (no lead
 * creation, no reassignment). See `CAPABILITIES` in LeadsWorkspace.
 */
export default function EmployeeLeadsPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <LeadsWorkspace workspaceRole="employee" basePath="/employee/leads" />
    </Suspense>
  );
}
