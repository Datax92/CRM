"use client";

import { Suspense } from "react";
import { GroupExpenseView } from "@/components/accounts/GroupExpenseView";
import { FullPageSpinner } from "@/components/admin/AdminShared";

/** `GroupExpenseView` reads `?month=` through `useSearchParams`, which needs a Suspense boundary. */
export default function GroupExpensePage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <GroupExpenseView />
    </Suspense>
  );
}
