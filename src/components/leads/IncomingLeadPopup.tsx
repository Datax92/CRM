"use client";

/**
 * "A lead has come in" — the offer, with Accept and Pass on.
 *
 * The owner asked for a popup that **slides in** when a lead arrives, carrying
 * both buttons, so an employee can answer without first finding the lead.
 *
 * Four things decide the shape of this:
 *
 * - **It portals to `document.body`.** Every page is wrapped in
 *   `.animate-page-transition`, whose `will-change: transform` makes it the
 *   containing block for `position: fixed` descendants — an un-portalled panel
 *   is pinned to the page's content box and lands cropped or under the phone's
 *   tab bar. CLAUDE.md records this as paid for in production.
 * - **The countdown is the point.** The window is {ACCEPT_WINDOW_MINUTES}
 *   minutes and the ring drains in real time, because "accept or it moves on"
 *   is only fair if the person can see how long they have.
 * - **Passing is a real choice, not a penalty screen.** It costs two points on
 *   the lane (`lib/leadPriority`) and the card says so, rather than letting
 *   somebody discover the cost after the fact.
 * - **Dismiss ≠ decline.** The × hides the card for this lead; it does not
 *   answer the offer. Closing a window must never give a lead away, so the
 *   lead stays assigned and the timer keeps running — the bell and the leads
 *   screen still carry it.
 *
 * Motion is transform and opacity only, and is switched off entirely under
 * `prefers-reduced-motion`.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Check, Phone, Sparkles, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useIncomingLead, ACCEPT_WINDOW_SECONDS } from "@/hooks/useIncomingLead";
import { acceptLead, passLead } from "@/lib/clientActions";
import { describeLeadSource } from "@/lib/leadSource";
import { ACCEPT_WINDOW_MINUTES } from "@/lib/constants/distribution";
import { formatTimeLeft } from "@/lib/distribution";
import { LEAD_SCORE_WEIGHTS } from "@/lib/leadPriority";
import { E } from "@/components/employees/directoryChrome";

/**
 * Motion lives in a stylesheet rather than inline, for one reason: an inline
 * style cannot carry a media query, and `prefers-reduced-motion` is not
 * optional here. Somebody who has asked their system for less motion must not
 * get a card sliding across their screen every time a lead lands.
 */
const OFFER_CSS = `
.lead-offer { transition: transform 320ms cubic-bezier(0.22,0.61,0.36,1), opacity 260ms ease; }
.lead-offer-clock { transition: width 1s linear, background 300ms ease; }
.lead-offer-head { transition: background 300ms ease; }
@media (prefers-reduced-motion: reduce) {
  .lead-offer, .lead-offer-clock, .lead-offer-head {
    transition: none !important;
    animation: none !important;
  }
}
`;

export function IncomingLeadPopup() {
  const { user, role, getIdToken } = useAuth();
  const isMobile = useIsMobile();
  const { offer } = useIncomingLead(user?.uid, role ?? undefined);

  /** Leads the employee has closed the card on — see the module note. */
  const [dismissed, setDismissed] = useState<string[]>([]);

  const leadId = offer?.lead.id ?? null;
  const visible = Boolean(leadId) && !dismissed.includes(leadId!);

  /**
   * Everything that belongs to *this* offer, in one object carrying whose offer
   * it is.
   *
   * **Reset during render, not in an effect.** A new lead is a new question, so
   * the entrance has to replay and any "Accepting…" or error from the last one
   * has to go — and an effect doing that would paint the previous lead's state
   * over the new lead's card for a frame first. The project's lint rule refuses
   * `setState` in an effect body for exactly this reason.
   */
  const [card, setCard] = useState<{
    id: string | null;
    shown: boolean;
    busy: null | "ACCEPT" | "PASS";
    failure: string | null;
  }>({ id: leadId, shown: false, busy: null, failure: null });

  if (card.id !== leadId) setCard({ id: leadId, shown: false, busy: null, failure: null });

  const { busy, failure } = card;

  useEffect(() => {
    if (!visible) return;
    /*
      One frame off-screen before the transition starts. Setting the final
      transform in the same paint as the mount gives no transition at all —
      the browser has nothing to animate from.
    */
    const frame = requestAnimationFrame(() =>
      // Guarded: a frame that lands after the offer moved on must not reveal
      // a card belonging to a lead that is no longer being offered.
      setCard((current) => (current.id === leadId ? { ...current, shown: true } : current))
    );
    return () => cancelAnimationFrame(frame);
  }, [visible, leadId]);

  const secondsLeft = useCountdown(offer?.expiresAt ?? null);
  const mounted = useMounted();

  if (!mounted || !visible || !offer) return null;

  const { lead } = offer;

  const answer = async (kind: "ACCEPT" | "PASS") => {
    // Every write is guarded on the card still being this lead's: an answer
    // that resolves after the window lapsed must not reopen a stale card.
    const settle = (patch: { busy: null | "ACCEPT" | "PASS"; failure: string | null }) =>
      setCard((current) => (current.id === lead.id ? { ...current, ...patch } : current));

    settle({ busy: kind, failure: null });
    try {
      const token = await getIdToken();
      const result = kind === "ACCEPT" ? await acceptLead(token, lead.id) : await passLead(token, lead.id);
      if (!result.ok) {
        settle({ busy: null, failure: result.error || "That did not go through." });
        return;
      }
      /*
        No success banner and nothing to close: the lead's own status changes,
        the query stops matching, and the card leaves. Reporting success in a
        panel that is about to disappear is the bug the Data Bank promotion
        banner had.
      */
    } catch {
      settle({ busy: null, failure: "Network error — the lead is still yours to answer." });
    }
  };

  const urgent = secondsLeft !== null && secondsLeft <= 60;
  const ringPercent =
    secondsLeft === null ? 100 : Math.max(0, Math.min(100, (secondsLeft / ACCEPT_WINDOW_SECONDS) * 100));

  return createPortal(
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="A new lead has been assigned to you"
      style={{
        position: "fixed",
        zIndex: 2147483000,
        // The phone gets a bar across the bottom above the tab bar and the home
        // indicator; the desktop gets a card in the corner. Neither covers the
        // screen — this interrupts, it does not block.
        ...(isMobile
          ? {
              left: 10,
              right: 10,
              bottom: `calc(78px + env(safe-area-inset-bottom, 0px))`,
            }
          : { right: 22, bottom: 22, width: 372 }),
        transform: card.shown ? "translateY(0)" : "translateY(22px)",
        opacity: card.shown ? 1 : 0,
      }}
      className="lead-offer"
    >
      <style>{OFFER_CSS}</style>
      <div
        style={{
          background: E.surface,
          border: `1px solid ${E.border}`,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 18px 44px rgba(19,44,42,0.22)",
          fontFamily: E.font,
          letterSpacing: E.tracking,
        }}
      >
        {/* The header carries the clock, because that is the whole urgency. */}
        <div
          style={{
            background: urgent ? E.red : E.deep,
            color: "#fff",
            padding: "11px 14px",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
          className="lead-offer-head"
        >
          <Sparkles size={15} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.9px", flex: 1 }}>
            NEW LEAD FOR YOU
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {secondsLeft === null ? `${ACCEPT_WINDOW_MINUTES}:00` : formatClock(secondsLeft)}
          </span>
          <button
            type="button"
            onClick={() => setDismissed((current) => [...current, lead.id])}
            aria-label="Hide this for now — the lead stays yours"
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              opacity: 0.75,
              cursor: "pointer",
              display: "flex",
              padding: 2,
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* The window draining, as a bar rather than a number alone. */}
        <div style={{ height: 3, background: E.rowBorder }}>
          <div
            style={{
              height: "100%",
              width: `${ringPercent}%`,
              background: urgent ? E.red : E.teal,
            }}
            className="lead-offer-clock"
          />
        </div>

        <div style={{ padding: "14px 15px 15px" }}>
          <p style={{ fontSize: 16.5, fontWeight: 800, color: E.ink, letterSpacing: "-0.4px" }}>
            {lead.name || "New lead"}
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginTop: 4,
              fontSize: 12.5,
              color: E.body,
            }}
          >
            <Phone size={13} style={{ color: E.tealInk, flexShrink: 0 }} />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{lead.phone || "No number"}</span>
          </div>
          <p style={{ fontSize: 11.5, color: E.label, marginTop: 5 }}>{describeLeadSource(lead)}</p>

          {failure && (
            <p
              style={{
                marginTop: 10,
                background: E.redBg,
                color: E.redInk,
                borderRadius: 10,
                padding: "8px 10px",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {failure}
            </p>
          )}

          <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
            <button
              type="button"
              onClick={() => void answer("ACCEPT")}
              disabled={busy !== null}
              style={{
                flex: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                // 44px, the minimum a thumb can hit reliably.
                padding: "12px 14px",
                borderRadius: 12,
                border: "none",
                background: E.teal,
                color: "#fff",
                fontSize: 14,
                fontWeight: 800,
                fontFamily: "inherit",
                cursor: busy ? "default" : "pointer",
                opacity: busy === "PASS" ? 0.5 : 1,
              }}
            >
              <Check size={16} />
              {busy === "ACCEPT" ? "Accepting…" : "Accept"}
            </button>
            <button
              type="button"
              onClick={() => void answer("PASS")}
              disabled={busy !== null}
              title={`Passing costs ${LEAD_SCORE_WEIGHTS.pass} points on your lane score`}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "12px 10px",
                borderRadius: 12,
                border: `1px solid ${E.border}`,
                background: E.field,
                color: E.body,
                fontSize: 13.5,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: busy ? "default" : "pointer",
                opacity: busy === "ACCEPT" ? 0.5 : 1,
              }}
            >
              <ArrowRightLeft size={15} />
              {busy === "PASS" ? "Passing…" : "Pass on"}
            </button>
          </div>

          {/* Said before the button is pressed, not discovered afterwards. */}
          <p style={{ fontSize: 10.5, color: E.faint, marginTop: 8, lineHeight: 1.5 }}>
            Passing hands it to the next person in the lane and costs{" "}
            {LEAD_SCORE_WEIGHTS.pass} points on your priority score.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Seconds remaining, ticking. Null when there is no deadline to count to. */
function useCountdown(expiresAt: number | null): number | null {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (expiresAt === null) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return useMemo(() => {
    if (expiresAt === null || now === 0) return null;
    return Math.max(0, Math.round((expiresAt - now) / 1000));
  }, [expiresAt, now]);
}

/** One formatter for every countdown — an overnight offer reads in hours. */
const formatClock = formatTimeLeft;

/**
 * Whether we are past the server render, for the portal.
 *
 * `useSyncExternalStore` with a server snapshot of `false` rather than an
 * effect that flips a flag — same answer, no `setState` in an effect body, and
 * it is the pattern `useIsMobile` already uses for the same question.
 */
const NEVER_CHANGES = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false
  );
}
