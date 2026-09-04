"use client";

/**
 * Employee Directory — the admin's view of the whole company.
 *
 * The screen itself is `DirectoryView`, which the sub admin's Team page renders
 * too. One component rather than two pages: the two were separate screens until
 * 2026-09-04, and looking like different products was the only thing wrong with
 * them being different files.
 */

import { DirectoryView } from "@/components/employees/DirectoryView";

export default function EmployeeDirectoryPage() {
  return <DirectoryView scope="admin" />;
}
