"use client";

/**
 * Lead priority — the lane, in the directory's design language.
 *
 * The page is a shell; everything is in `PriorityLaneView`, which is also where
 * the phone layout lives. See that file for why the order is what it is.
 */

import { PriorityLaneView } from "@/components/employees/PriorityLaneView";

export default function PrioritySettingsPage() {
  return <PriorityLaneView />;
}
