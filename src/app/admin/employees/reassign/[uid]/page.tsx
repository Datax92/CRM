"use client";

import { use } from "react";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { ReassignWorkspace } from "@/components/employees/ReassignWorkspace";

/** One person's open leads, to be picked and handed to somebody else. Admin only. */
export default function ReassignLeadsPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = use(params);
  useProtectedRoute(["admin"]);
  return <ReassignWorkspace uid={uid} />;
}
