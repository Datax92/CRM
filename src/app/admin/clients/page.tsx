"use client";

import { ClientFoldersView } from "@/components/clients/ClientFoldersView";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/** Clients (§15–§20) — folders over leads that already exist. */
export default function ClientsPage() {
  useProtectedRoute(["admin"]);
  return <ClientFoldersView basePath="/admin/clients" />;
}
