"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { InvestedNowSummaryView } from "@/components/accounts/InvestedNowSummaryView";

function InvestedNowContent() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("bookId") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  return <InvestedNowSummaryView bookId={bookId} from={from} to={to} />;
}

export default function InvestedNowPage() {
  return (
    <Suspense fallback={null}>
      <InvestedNowContent />
    </Suspense>
  );
}
