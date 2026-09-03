"use client";

import { use } from "react";
import { ClientFolderView } from "@/components/clients/ClientFolderView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

export default function ClientFolderPage({ params }: { params: Promise<{ folderId: string }> }) {
  // Next hands route params as a promise; `use` unwraps it in the client
  // component without an effect.
  const { folderId } = use(params);
  useProtectedRoute(["admin"]);
  return <ClientFolderView folderId={folderId} basePath="/admin/clients" />;
}
