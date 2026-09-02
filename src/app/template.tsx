"use client";

import React from "react";

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-page-transition flex-1 flex flex-col w-full min-h-full">
      {children}
    </div>
  );
}
