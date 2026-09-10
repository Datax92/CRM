"use client";

/**
 * The way out of a section, on every page in it.
 *
 * **A phone needs a Back that belongs to the app.** The browser gesture is not
 * always there — a page opened from a notification, a tab restored days later,
 * an installed PWA — and even where it is, it undoes navigation rather than
 * going *up*: a lead opened from three places goes back to three different
 * screens. This is up, always, and it names where it goes.
 *
 * Rendered by the Accounts layout, so every page under it has one without each
 * page remembering to. It draws only on the phone; on the desktop the sidebar
 * is the way out and a second one would be noise.
 */

import { useRouter } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";
import { M } from "./mobileChrome";

export function MobileBackBar({ label, href }: { label: string; href: string }) {
  const isMobile = useIsMobile();
  const router = useRouter();
  if (!isMobile) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 12px" }}>
      <button
        type="button"
        onClick={() => router.push(href)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "9px 15px 9px 11px", borderRadius: 999,
          border: `1px solid ${M.cardBorder}`, background: "#fff",
          color: M.body, fontSize: 13, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      </button>
    </div>
  );
}
