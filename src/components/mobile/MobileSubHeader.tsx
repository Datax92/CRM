"use client";

/**
 * The header every phone sub-screen gets: back, title, account.
 *
 * The five-slot tab bar reaches five destinations. Everything else — the
 * attendance screens, the money screens, the client folders — is reached from
 * the account sheet, and once you are on one of them there was **no way back
 * and no way anywhere else**: no back control, and on some screens no account
 * button either. That is the gap this closes, and it is why it takes both.
 *
 * Back is `router.back()` rather than a fixed href: these screens are reached
 * from several places (the tab bar, the account sheet, a link on a dashboard),
 * and a hard-coded parent would send people somewhere they did not come from.
 * When there is no history to go back to — a deep link, a refresh — it falls
 * back to the supplied `home`.
 */

import { useRouter } from "next/navigation";
import { M } from "./mobileChrome";
import { AccountButton } from "./MobileAccount";

export function MobileSubHeader({
  eyebrow,
  title,
  subtitle,
  /** Where Back goes when there is no history — a deep link or a refresh. */
  home,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  home: string;
  action?: React.ReactNode;
}) {
  const router = useRouter();

  const goBack = () => {
    // `history.length <= 1` means this tab opened straight onto this screen,
    // so there is nothing behind it to return to.
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(home);
  };

  return (
    <div
      style={{
        background: M.teal,
        color: "#fff",
        borderRadius: `0 0 ${M.headerRadius}px ${M.headerRadius}px`,
        padding: "calc(env(safe-area-inset-top, 0px) + 12px) 18px 16px",
        margin: "-18px -16px 16px",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="mob-press"
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.4)",
            background: "rgba(255,255,255,0.16)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: "pointer",
            padding: 0,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>

        <div style={{ minWidth: 0, flex: 1 }}>
          {eyebrow && (
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "1.2px",
                textTransform: "uppercase",
                opacity: 0.78,
              }}
            >
              {eyebrow}
            </div>
          )}
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: "-0.35px",
              marginTop: 1,
              color: "#fff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p style={{ fontSize: 12, fontWeight: 500, opacity: 0.85, marginTop: 2 }}>{subtitle}</p>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
          {action}
          <AccountButton />
        </div>
      </div>
    </div>
  );
}
