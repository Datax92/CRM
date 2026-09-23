"use client";

import { use } from "react";
import { MetaLeadsFolder } from "@/components/leads/MetaLeadsFolder";

/** One Meta campaign's leads across a manager's team — see `MetaLeadsFolder` (`scope="team"`). */
export default function TeamMetaAdsFolderPage({ params }: { params: Promise<{ folderId: string }> }) {
  // Next 15+ hands route params as a promise; `use` unwraps it without an effect.
  const { folderId } = use(params);
  return <MetaLeadsFolder folderId={folderId} scope="team" />;
}
