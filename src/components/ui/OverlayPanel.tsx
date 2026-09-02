"use client";

/**
 * The one overlay every full-screen panel in this app is built on.
 *
 * **Why it exists — the "half-window" bug.** Every page is wrapped in
 * `.animate-page-transition`, which carries `will-change: opacity, transform`.
 * A `will-change: transform` element becomes the **containing block for its
 * `position: fixed` descendants** — so an overlay written as
 * `position: fixed; inset: 0` inside a page is not pinned to the viewport at
 * all. It is pinned to the page's content box: cropped, offset, scrolling with
 * the wrong thing, and appearing "stuck in half a window". That is exactly the
 * reported symptom, and it is invisible in review because the CSS looks right.
 *
 * `LeadDetailModal` has always escaped it by portalling to `document.body`;
 * the newer panels did not, which is why the older leads modal looked fine and
 * the newer Closed Deal and Profit Distribution panels did not. **Portalling is
 * therefore not a detail of this component — it is the whole point**, and every
 * overlay goes through here so it cannot be forgotten again.
 *
 * **One panel, two shapes.** On a phone it is a full-height sheet that owns the
 * screen, with safe-area padding so the header clears the notch and the footer
 * clears the home indicator. On a desktop it is a centred dialog capped at
 * `92vh`. Both put the scroll on the *body* only, so the header and the footer
 * actions stay put however long the content is — a long form must never push
 * its own Save button out of reach.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * "Are we on the client yet?" without a setState-in-effect.
 *
 * A portal needs `document`, which does not exist during the server render.
 * `useSyncExternalStore` answers `false` on the server and `true` on the
 * client, so the hydration pass matches and React swaps before paint — the
 * same pattern `useIsMobile` uses, and the one this project's lint rule is
 * pointing at when it rejects `setState` inside an effect.
 */
const noopSubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

const T = {
  ink: "#1f3b39",
  line: "#dceae8",
  surface: "#ffffff",
  ground: "#f3faf9",
  teal: "#2f7d78",
  tealMid: "#3f8f8a",
};

export interface OverlayPanelProps {
  title: string;
  subtitle?: string;
  /** Sits left of the title in the header well. */
  icon?: ReactNode;
  /** Rendered to the right of the title — a status pill, usually. */
  headerAside?: ReactNode;
  /** Extra header content below the title row: figure strips, tabs. */
  headerExtra?: ReactNode;
  /** Sticky action row. Omitted entirely when there is nothing to do. */
  footer?: ReactNode;
  /** Desktop width cap. The phone is always full-bleed. */
  maxWidth?: number;
  onClose: () => void;
  children: ReactNode;
}

export function OverlayPanel({
  title,
  subtitle,
  icon,
  headerAside,
  headerExtra,
  footer,
  maxWidth = 780,
  onClose,
  children,
}: OverlayPanelProps) {
  const isMobile = useIsMobile();
  const mounted = useMounted();

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  const panel = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        // Only a click on the backdrop itself closes. `mousedown` rather than
        // `click`, so a text selection that starts inside the panel and ends
        // on the backdrop does not dismiss the form the user was reading.
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(15, 42, 40, 0.5)",
        display: "flex",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "center",
        padding: isMobile ? 0 : "clamp(16px, 4vh, 40px) clamp(16px, 4vw, 40px)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          maxWidth: isMobile ? "none" : maxWidth,
          // 100dvh, not vh: on a mobile browser `vh` is the *largest* viewport,
          // so a vh-tall sheet hides its own footer behind the URL bar.
          height: isMobile ? "100dvh" : undefined,
          maxHeight: isMobile ? "100dvh" : "92vh",
          minHeight: 0,
          background: T.ground,
          borderRadius: isMobile ? 0 : 18,
          overflow: "hidden",
          boxShadow: isMobile ? "none" : "0 26px 64px rgba(15,42,40,0.32)",
        }}
      >
        <header
          style={{
            flexShrink: 0,
            color: "#fff",
            background: `linear-gradient(135deg, ${T.teal} 0%, ${T.tealMid} 100%)`,
            padding: isMobile
              ? "calc(env(safe-area-inset-top, 0px) + 16px) 18px 16px"
              : "18px 22px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              {icon && (
                <span
                  aria-hidden
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.18)",
                    border: "1.5px solid rgba(255,255,255,0.5)",
                    flexShrink: 0,
                  }}
                >
                  {icon}
                </span>
              )}
              <div style={{ minWidth: 0 }}>
                <h2
                  style={{
                    fontSize: isMobile ? 17 : 18,
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {title}
                </h2>
                {subtitle && (
                  <p
                    style={{
                      fontSize: 12.5,
                      opacity: 0.88,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              {headerAside}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {headerExtra && <div style={{ marginTop: 16 }}>{headerExtra}</div>}
        </header>

        {/* The only scrolling region. Keeping it here rather than on the whole
            panel is what pins the header and the footer actions. */}
        <div
          className="teal-scrollbar"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            padding: isMobile ? "16px 16px 22px" : "18px 22px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {children}
        </div>

        {footer && (
          <footer
            style={{
              flexShrink: 0,
              borderTop: `1px solid ${T.line}`,
              background: T.surface,
              padding: isMobile
                ? "12px 16px calc(env(safe-area-inset-bottom, 0px) + 14px)"
                : "14px 22px",
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );

  // Straight onto the body, clear of every transformed ancestor. See the note
  // at the top of this file — this line is the fix for the half-window bug.
  return createPortal(panel, document.body);
}

/**
 * A section inside an overlay: the card language the Data Bank and KYC forms
 * use, so a panel assembled from these looks like the rest of the product
 * without each one restating the styling.
 */
export function OverlayCard({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon?: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: T.surface,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          padding: "11px 16px",
          borderBottom: "1px solid #f0f6f5",
        }}
      >
        <h3
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: "0.6px",
            textTransform: "uppercase",
            color: "#5b6d6b",
          }}
        >
          {icon && (
            <span style={{ color: T.teal }} aria-hidden>
              {icon}
            </span>
          )}
          {title}
        </h3>
        {hint && <span style={{ fontSize: 11.5, color: "#9aacaa" }}>{hint}</span>}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

/**
 * The figure strip that sits in an overlay header.
 *
 * Wraps to two rows on a narrow phone rather than shrinking the numbers to
 * illegibility — a money figure that ellipsises becomes a different, wrong
 * number.
 */
export function OverlayFigures({
  items,
}: {
  items: Array<{ label: string; value: string; strong?: boolean }>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(112px, 1fr))`,
        gap: 10,
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            borderRadius: 12,
            background: `rgba(255,255,255,${item.strong ? 0.22 : 0.12})`,
            border: `1px solid rgba(255,255,255,${item.strong ? 0.45 : 0.22})`,
            padding: "9px 12px",
            minWidth: 0,
          }}
        >
          <p style={{ fontSize: 9.5, letterSpacing: "0.7px", textTransform: "uppercase", opacity: 0.82 }}>
            {item.label}
          </p>
          <p
            style={{
              fontSize: item.strong ? 16 : 14.5,
              fontWeight: item.strong ? 800 : 600,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}
