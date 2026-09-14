"use client";

/**
 * An employee's Facebook leads — what is being offered, and what they took.
 *
 * **Why this screen exists.** A Meta lead is now offered to one person at a
 * time down the priority lane, with five minutes to answer. The popup catches
 * somebody who is looking at the app; this is where they come when they were
 * not. Offers at the top with the clock still running, their own Facebook leads
 * underneath.
 *
 * **It shows offers and accepted leads together**, the owner's call: one screen
 * answering both "is anything waiting for me" and "what has come in from
 * Facebook". An offers-only inbox is empty almost all the time, which teaches
 * people not to open it.
 *
 * Built in the directory's language (`directoryChrome`) so it belongs to the
 * same app as the priority lane it is the other half of.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Check, Clock, Megaphone, Phone, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { acceptLead, passLead } from "@/lib/clientActions";
import { describeLeadSource } from "@/lib/leadSource";
import { ACCEPT_WINDOW_MINUTES } from "@/lib/constants/distribution";
import { LEAD_SCORE_WEIGHTS } from "@/lib/leadPriority";
import { timestampMillis, formatBusinessDate } from "@/lib/dates";
import { statusLabel } from "@/lib/leadStatus";
import { FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { E, Card, HeroRings } from "@/components/employees/directoryChrome";

/** Anything that came from a Facebook ad, whichever door it arrived through. */
const isMeta = (lead: Lead) => (lead.source ?? "").toUpperCase() === "META_ADS";

export function MetaLeadsView() {
  const { user, role, getIdToken } = useAuth();
  useProtectedRoute(["employee"]);
  const isMobile = useIsMobile();

  const { leads, loading, error } = useLeads(role === "employee" ? "employee" : null, user?.uid);

  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const { offers, mine } = useMemo(() => {
    const meta = leads.filter(isMeta);
    return {
      // Being offered right now: still ASSIGNED, nobody has answered.
      offers: meta
        .filter((lead) => lead.status === "ASSIGNED")
        .sort(
          (a, b) =>
            (timestampMillis(a.acceptDeadlineAt) ?? Infinity) -
            (timestampMillis(b.acceptDeadlineAt) ?? Infinity)
        ),
      mine: meta
        .filter((lead) => lead.status !== "ASSIGNED")
        .sort(
          (a, b) => (timestampMillis(b.createdAt) ?? 0) - (timestampMillis(a.createdAt) ?? 0)
        ),
    };
  }, [leads]);

  const answer = async (lead: Lead, kind: "ACCEPT" | "PASS") => {
    setBusy(lead.id);
    setBanner(null);
    try {
      const token = await getIdToken();
      const result = kind === "ACCEPT" ? await acceptLead(token, lead.id) : await passLead(token, lead.id);
      setBanner(
        result.ok
          ? {
              tone: "success",
              text:
                kind === "ACCEPT"
                  ? `${lead.name} is yours. Call them now — it came from a paid ad.`
                  : `${lead.name} passed to the next person in the lane.`,
            }
          : { tone: "error", text: result.error || "That did not go through." }
      );
    } catch {
      setBanner({ tone: "error", text: "Network error — the lead is still yours to answer." });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <FullPageSpinner />;

  return (
    <div
      style={{
        margin: isMobile ? -16 : -24,
        minHeight: "100%",
        background: E.page,
        padding: isMobile ? "16px 14px 28px" : "22px 26px 32px",
        fontFamily: E.font,
        letterSpacing: E.tracking,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 20,
          background: isMobile ? E.gradientMobile : E.gradient,
          color: "#fff",
          padding: isMobile ? "20px 20px 22px" : "24px 28px",
        }}
      >
        <HeroRings />
        <div style={{ position: "relative" }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", opacity: 0.85 }}>
            FACEBOOK
          </p>
          <h1
            style={{
              fontFamily: E.font,
              fontSize: isMobile ? 25 : 31,
              fontWeight: 800,
              letterSpacing: "-0.9px",
              marginTop: 2,
              color: "#fff",
            }}
          >
            Meta Leads
          </h1>
          <p style={{ fontSize: 12.5, opacity: 0.92, marginTop: 6, maxWidth: 560, lineHeight: 1.6 }}>
            {offers.length > 0
              ? `${offers.length} waiting for your answer. Accept within ${ACCEPT_WINDOW_MINUTES} minutes or it moves to the next person.`
              : "Nothing waiting. New Facebook leads appear here the moment they are offered to you."}
          </p>
          <div style={{ display: "flex", gap: isMobile ? 22 : 34, marginTop: 18 }}>
            <HeroStat label="WAITING" value={offers.length} />
            <HeroStat label="YOURS" value={mine.length} />
          </div>
        </div>
      </section>

      {error && <Banner tone="error" text={error} />}
      {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}

      {/* ---------------------------------------------------------------- */}
      {/* Waiting for an answer                                            */}
      {/* ---------------------------------------------------------------- */}
      {offers.length > 0 && (
        <>
          <SectionHeading icon={<Sparkles size={14} />} text="Waiting for your answer" tone="teal" />
          {offers.map((lead) => (
            <OfferCard
              key={lead.id}
              lead={lead}
              busy={busy === lead.id}
              disabled={busy !== null}
              isMobile={isMobile}
              onAnswer={(kind) => void answer(lead, kind)}
            />
          ))}
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Already theirs                                                   */}
      {/* ---------------------------------------------------------------- */}
      <SectionHeading icon={<Megaphone size={14} />} text="Your Facebook leads" tone="muted" />
      {mine.length === 0 ? (
        <Card style={{ padding: "34px 20px", textAlign: "center" }}>
          <Megaphone size={26} style={{ color: E.hair, marginBottom: 8 }} />
          <p style={{ fontSize: 13.5, color: E.faint }}>
            None yet. Leads you accept from a Facebook ad collect here.
          </p>
        </Card>
      ) : (
        mine.map((lead) => <MineRow key={lead.id} lead={lead} isMobile={isMobile} />)
      )}
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.1px", opacity: 0.8 }}>{label}</p>
      <p style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.6px", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
        {value}
      </p>
    </div>
  );
}

function SectionHeading({ icon, text, tone }: { icon: React.ReactNode; text: string; tone: "teal" | "muted" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
      <span style={{ color: tone === "teal" ? E.tealInk : E.label, display: "flex" }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1px", color: tone === "teal" ? E.tealInk : E.label }}>
        {text.toUpperCase()}
      </span>
    </div>
  );
}

function OfferCard({
  lead, busy, disabled, isMobile, onAnswer,
}: {
  lead: Lead;
  busy: boolean;
  disabled: boolean;
  isMobile: boolean;
  onAnswer: (kind: "ACCEPT" | "PASS") => void;
}) {
  return (
    <Card style={{ padding: 0, overflow: "hidden", border: `1px solid ${E.hair}` }}>
      <div style={{ height: 3, background: E.teal }} />
      <div style={{ padding: isMobile ? "14px 15px" : "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: isMobile ? 15.5 : 16.5, fontWeight: 800, color: E.ink, letterSpacing: "-0.4px" }}>
            {lead.name || "New lead"}
          </span>
          <Countdown deadline={lead.acceptDeadlineAt} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5, fontSize: 13, color: E.body }}>
          <Phone size={13} style={{ color: E.tealInk, flexShrink: 0 }} />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{lead.phone || "No number"}</span>
        </div>
        <p style={{ fontSize: 11.5, color: E.label, marginTop: 4 }}>{describeLeadSource(lead)}</p>
        {lead.notes && (
          <p style={{ fontSize: 12, color: E.muted, marginTop: 7, lineHeight: 1.55, background: E.tint, borderRadius: 10, padding: "8px 10px" }}>
            {lead.notes}
          </p>
        )}

        <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
          <button
            type="button"
            onClick={() => onAnswer("ACCEPT")}
            disabled={disabled}
            style={{
              flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              padding: "12px 14px", borderRadius: 12, border: "none", background: E.teal, color: "#fff",
              fontSize: 14, fontWeight: 800, fontFamily: "inherit",
              cursor: disabled ? "default" : "pointer", opacity: disabled && !busy ? 0.5 : 1,
            }}
          >
            <Check size={16} />
            {busy ? "Working…" : "Accept"}
          </button>
          <button
            type="button"
            onClick={() => onAnswer("PASS")}
            disabled={disabled}
            title={`Passing costs ${LEAD_SCORE_WEIGHTS.pass} points on your lane score`}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "12px 10px", borderRadius: 12, border: `1px solid ${E.border}`,
              background: E.field, color: E.body, fontSize: 13.5, fontWeight: 700,
              fontFamily: "inherit", cursor: disabled ? "default" : "pointer",
              opacity: disabled && !busy ? 0.5 : 1,
            }}
          >
            <ArrowRightLeft size={15} />
            Pass on
          </button>
        </div>
        {/* Said before the button, not discovered after it. */}
        <p style={{ fontSize: 10.5, color: E.faint, marginTop: 8, lineHeight: 1.5 }}>
          Passing hands it to the next person in the lane and costs{" "}
          {LEAD_SCORE_WEIGHTS.pass} points on your priority score.
        </p>
      </div>
    </Card>
  );
}

/** Minutes and seconds left, ticking, or "Window closed" once it lapses. */
function Countdown({ deadline }: { deadline: Lead["acceptDeadlineAt"] }) {
  const expiresAt = timestampMillis(deadline);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (expiresAt === null) return;
    /*
      `Date.now()` belongs in the timer, never in a render body — the project's
      lint rule refuses an impure call there, and a clock read during render
      would also make this component render differently on the server.
    */
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // 0 is "the clock has not been read yet", which is one render, not a lapsed
  // window — showing "Window closed" for that frame would be a lie.
  if (expiresAt === null || now === 0) return null;

  const left = Math.max(0, Math.round((expiresAt - now) / 1000));
  const urgent = left <= 60;
  const lapsed = left === 0;

  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999,
        background: lapsed ? E.page : urgent ? E.redBg : E.tealTint,
        color: lapsed ? E.faint : urgent ? E.redInk : E.tealInk,
        padding: "3px 10px", fontSize: 11.5, fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Clock size={11} />
      {lapsed
        ? "Window closed — moving on"
        : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`}
    </span>
  );
}

function MineRow({ lead, isMobile }: { lead: Lead; isMobile: boolean }) {
  return (
    <Card style={{ padding: isMobile ? "12px 14px" : "13px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: E.ink, letterSpacing: "-0.2px" }}>
            {lead.name || "Unnamed"}
          </p>
          <p style={{ fontSize: 11.5, color: E.label, marginTop: 2 }}>
            {lead.phone || "No number"} · {describeLeadSource(lead)}
          </p>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <span
            style={{
              display: "inline-block", borderRadius: 999, background: E.tint, color: E.tealInk,
              padding: "3px 10px", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap",
            }}
          >
            {statusLabel(lead.status)}
          </span>
          <p style={{ fontSize: 10.5, color: E.faint, marginTop: 3 }}>
            {formatBusinessDate(lead.createdAt)}
          </p>
        </div>
      </div>
    </Card>
  );
}
