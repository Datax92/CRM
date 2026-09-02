"use client";

import { use } from "react";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { FolderWorkspace } from "@/components/dataBank/FolderWorkspace";

export default function DataBankFolderPage({ params }: { params: Promise<{ folderId: string }> }) {
  // Next 15+ hands route params as a promise; `use` unwraps it in the client
  // component without an effect.
  const { folderId } = use(params);
  useProtectedRoute(["admin", "subadmin"]);
  return <FolderWorkspace folderId={folderId} />;
}
