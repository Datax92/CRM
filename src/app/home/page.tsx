"use client";

/**
 * The Day End Dashboard.
 *
 * Built to `Day End Dashboard.dc.html` from the Claude Design project — the
 * grid definitions, paddings, type scale and colours below are the design's own
 * values, not estimates from a screenshot. See `dayEndChrome` for why every one
 * of them is an inline style.
 *
 * Same page, two scopes: an admin sees the whole team summed, an employee sees
 * only their own numbers. Nothing is role-forked beyond that scope and the
 * "leads waiting to be accepted" block, which only an employee can act on.
 *
 * Everything measured is an attainment against a target (see `lib/kpi`):
 *
 *   Attendance       observed from activity, located by IP (`lib/attendance`)
 *   MTD / YTD        weighted attainment across the three KPIs
 *   KPI - MTD        each KPI this month against this month's target
 *   KPI - YTD        the year month by month, all three series
 *   Target Achieved  revenue against the revenue target
 *   Portfolio (YTD)  closed revenue split by deal category
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileDashboard } from "@/components/mobile/MobileDashboard";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { FullPageSpinner } from "@/components/admin/AdminShared";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { useEmployeeKpi, useTeamKpi } from "@/hooks/useKpi";
import { useMyProfile } from "@/hooks/useEmployees";
import { useAttendance, usePunchRequirements } from "@/hooks/useAttendance";
import { formatMoney } from "@/lib/money";
import { DEAL_CATEGORIES } from "@/lib/constants/deals";
import { MONTH_SHORT_LABELS } from "@/lib/kpi";
import { LeadDetailModal } from "@/components/LeadDetailModal";
import { AttendanceStrip } from "@/components/dashboard/AttendanceStrip";
import { useElementWidth } from "@/components/dashboard/useElementWidth";
import {
  BriefcaseIcon,
  ChartLegend,
  D,
  MonthChart,
  PortfolioRow,
  Ring,
  SectionCard,
  TargetIcon,
  TrendIcon,
  type MonthBars,
} from "@/components/dashboard/dayEndChrome";

/**
 * Below this container width the design's three-column top row and its
 * 0.82 / 1.18 splits cannot hold their minimums, so the rows stack. Measured on
 * the container in JS rather than declared in a media query — a stylesheet is a
 * build artefact, and a breakpoint that silently fails to load renders the
 * narrow layout on a wide screen.
 */
const WIDE = 860;

/** The design's own phone glyph, for the floating action button. */
const PHONE_PATH =
  "M5 4h3l2 5-2.2 1.6a12 12 0 0 0 5.6 5.6L15 14l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3 6.2 2 2 0 0 1 5 4Z";

/** `PKR 5.9M` — the portfolio format the design prints. */
function pkrMillions(amount: number): string {
  return `PKR ${(amount / 1_000_000).toFixed(1)}M`;
}

function CountdownBadge({ deadline }: { deadline: { toMillis?: () => number } | null | undefined }) {
  const deadlineMs = deadline?.toMillis?.() ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineMs) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [deadlineMs]);

  if (!deadlineMs) return null;

  const remaining = deadlineMs - now;
  const expired = remaining <= 0;
  const minutes = Math.floor(Math.max(remaining, 0) / 60000);
  const seconds = Math.floor((Math.max(remaining, 0) % 60000) / 1000);

  return (
    <span
      style={{
        display: "flex",
        flexShrink: 0,
        alignItems: "center",
        gap: 5,
        borderRadius: 16,
        border: `1px solid ${expired ? "#efc9c0" : "#e3d8bf"}`,
        background: expired ? "#fdeeeb" : "#fbf6ea",
        padding: "3px 10px",
        fontSize: 11.5,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        color: expired ? "#a33a29" : "#8a7440",
      }}
    >
      {expired ? "Window closed" : `${minutes}:${String(seconds).padStart(2, "0")} left`}
    </span>
  );
}

/** One of the two gradient gauge cards beside Attendance. */
function GaugeCard({
  label,
  percent,
  background,
}: {
  label: string;
  percent: number;
  background: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "18px 20px",
        borderRadius: D.cardRadius,
        color: "#fff",
        background,
        boxShadow: D.gaugeShadow,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.3px" }}>{label}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          minWidth: 0,
        }}
      >
        <Ring
          percent={percent}
          label={`${percent.toFixed(1)}%`}
          color="#ffffff"
          trackColor="rgba(255,255,255,0.28)"
          viewBox={96}
          radius={38}
          strokeWidth={9}
          maxWidth={96}
          valueColor="#fff"
        />
      </div>
    </div>
  );
}

export default function HomePage() {
  const { user, role, loading, getIdToken } = useAuth();
  const { isAuthorized } = useProtectedRoute(["admin", "subadmin", "employee"]);
  const isAdmin = role === "admin";
  // A sub admin reads the dashboard as a manager — the same panels, summed over
  // their own team rather than the whole company.
  const isManager = role === "admin" || role === "subadmin";
  // The phone gets a different screen, not a narrowed one — see
  // `components/mobile`. Hooks below still run so the branch stays above no
  // conditional hook call.
  const isMobile = useIsMobile();

  const { leads } = useLeads((role as "admin" | "employee") ?? null, user?.uid);
  const profile = useMyProfile(user?.uid);
  const teamKpi = useTeamKpi(isManager, role === "subadmin" ? user?.uid : null);
  const ownKpi = useEmployeeKpi(isManager ? undefined : user?.uid, profile.targets);
  const kpi = isManager ? teamKpi : ownKpi;
  const attendance = useAttendance(user?.uid, getIdToken);
  const { wifiRequired, locationRequired, refreshPunchRules } = usePunchRequirements(getIdToken);
  const [punchNote, setPunchNote] = useState<{ ok: boolean; message: string } | null>(null);

  const runPunch = async (kind: "IN" | "OUT") => {
    // Only the check-in is gated, so only the check-in asks for a position.
    const result = await attendance.punch(kind, {
      withLocation: locationRequired && kind === "IN",
    });
    setPunchNote(result);
    // A refusal may be the first this browser hears that the office now checks
    // the network name — re-ask, so the box the message tells them to use
    // actually appears.
    if (!result.ok) refreshPunchRules();
  };

  const { ref: frameRef, width: frameWidth } = useElementWidth<HTMLDivElement>();
  const wide = frameWidth >= WIDE;

  const [viewingLead, setViewingLead] = useState<Lead | null>(null);

  const months = useMemo<MonthBars[]>(
    () =>
      kpi.byMonth.map((month, index) => ({
        label: MONTH_SHORT_LABELS[index],
        values: [month.counts.connects, month.counts.registrations, month.counts.meetings],
      })),
    [kpi.byMonth]
  );

  if (loading || !user || !isAuthorized) {
    return <FullPageSpinner />;
  }

  if (isMobile) return <MobileDashboard />;

  const awaitingAccept = leads.filter((lead) => lead.status === "ASSIGNED");

  // The person's real name if we have it; otherwise the local part of their
  // email, title-cased, which is still better than "there".
  const displayName =
    profile.name ??
    (user.email
      ? user.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : isAdmin
        ? "Admin"
        : "there");

  const portfolioMax = Math.max(...DEAL_CATEGORIES.map((c) => kpi.portfolio[c] ?? 0), 0);
  const portfolioTotal = DEAL_CATEGORIES.reduce((sum, c) => sum + (kpi.portfolio[c] ?? 0), 0);

  // A denied read is not a quiet month. Saying so beats a wall of honest-looking
  // zeros that are really a permissions problem.
  const dataError = kpi.error ?? attendance.error;

  const legend = [
    { label: "Connects", color: D.series[0] },
    { label: "Client Registration", color: D.series[1] },
    { label: "Meeting", color: D.series[2] },
  ];

  const splitRow: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: wide ? "minmax(0,0.82fr) minmax(0,1.18fr)" : "minmax(0,1fr)",
    gap: 16,
  };

  return (
    // Full-bleed: the design owns its own 26/28/34 padding, so the app shell's
    // padding is cancelled rather than added to it.
    <div
      ref={frameRef}
      style={{
        margin: -24,
        padding: "26px 28px 34px",
        minHeight: "100%",
        background: D.page,
        color: "#2b3a39",
        fontFamily: "var(--font-dashboard), 'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Greeting                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.9px", color: D.ink }}>
          Hi {displayName}
        </div>
        <div
          style={{
            fontSize: 25,
            fontWeight: 700,
            letterSpacing: "-0.6px",
            color: D.tealLight,
            marginTop: 2,
          }}
        >
          Day End Report
        </div>
      </div>

      {dataError && (
        <div
          role="alert"
          style={{
            display: "flex",
            gap: 10,
            borderRadius: D.cardRadius,
            border: "1px solid #f0c4bd",
            background: "#fdeeeb",
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13,
            color: "#a33a29",
          }}
        >
          <span>
            {dataError} Figures below may read zero until this is resolved — if these collections
            are new, the Firestore Security Rules need deploying (<code>npm run deploy:rules</code>).
          </span>
        </div>
      )}

      {/* The result of the last Check In / Check Out. Sits above the strip so
          the confirmation is where the eye already is after pressing. */}
      {punchNote && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            borderRadius: D.cardRadius,
            border: `1px solid ${punchNote.ok ? "#bfe0dc" : "#f0c4bd"}`,
            background: punchNote.ok ? "#eef8f7" : "#fdeeeb",
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13,
            fontWeight: 500,
            color: punchNote.ok ? "#1f5c58" : "#a33a29",
          }}
        >
          <span>{punchNote.message}</span>
          <button
            onClick={() => setPunchNote(null)}
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12.5,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Leads waiting on this employee — the one action on an otherwise      */}
      {/* read-only report.                                                    */}
      {!isManager && awaitingAccept.length > 0 && (
        <div
          style={{
            borderRadius: D.cardRadius,
            border: "1px solid #e3d8bf",
            background: "#fbf6ea",
            padding: "16px 20px",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "#6f5a29", marginBottom: 12 }}>
            {awaitingAccept.length} lead{awaitingAccept.length === 1 ? "" : "s"} waiting for you to
            accept
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {awaitingAccept.map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => setViewingLead(lead)}
                style={{
                  display: "flex",
                  width: "100%",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  borderRadius: 10,
                  border: "1px solid #efe6d0",
                  background: "#fff",
                  padding: "12px 16px",
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: D.ink }}>{lead.name}</span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      fontSize: 12,
                      color: D.monthLabel,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {lead.source.replace(/_/g, " ").toLowerCase()}
                    {lead.campaignName ? ` · ${lead.campaignName}` : ""}
                  </span>
                </span>
                <span style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 12 }}>
                  {lead.acceptDeadlineAt && <CountdownBadge deadline={lead.acceptDeadlineAt} />}
                  <span
                    style={{
                      borderRadius: 8,
                      background: D.teal,
                      padding: "8px 14px",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#fff",
                    }}
                  >
                    Review &amp; Accept
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Attendance + the two gauges                                         */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: wide
            ? "minmax(320px,1fr) minmax(150px,212px) minmax(150px,212px)"
            : "minmax(0,1fr)",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <AttendanceStrip
          today={attendance.today}
          // Everyone punches, admins included. Hiding this from admins was a
          // wrong call: the account that runs the office is also an account
          // that turns up to it, and it is the one most likely to be signed in.
          onPunch={(kind) => void runPunch(kind)}
          punching={attendance.punching}
          checkedOut={attendance.checkedOut}
          wifiRequired={wifiRequired}
          locationRequired={locationRequired}
        />
        <GaugeCard label="MTD" percent={kpi.mtdOverall * 100} background={D.mtdBg} />
        <GaugeCard label="YTD" percent={kpi.ytdOverall * 100} background={D.ytdBg} />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* KPI - MTD and KPI - YTD                                             */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ ...splitRow, marginBottom: 16 }}>
        <SectionCard icon={TrendIcon} title="KPI - MTD" padding="20px 22px 24px">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))",
              gap: "14px 12px",
            }}
          >
            {kpi.mtdReadings.map((reading, index) => (
              <div
                key={reading.metric}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  minWidth: 0,
                }}
              >
                <Ring
                  // The arc stops at a full circle; the printed figure does not.
                  percent={Math.min(reading.percent, 100)}
                  label={`${reading.percent}%`}
                  color={reading.ratio >= 1 ? D.kpiOnTarget[index] : D.amber}
                  trackColor={D.donutTrack}
                  viewBox={104}
                  radius={42}
                  strokeWidth={10}
                  maxWidth={104}
                />
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: D.body,
                    textAlign: "center",
                    minWidth: 0,
                  }}
                >
                  {reading.label}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          icon={TrendIcon}
          title="KPI - YTD"
          padding="20px 22px 18px"
          actions={
            <span style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <ChartLegend items={legend} />
              <span
                style={{
                  padding: "4px 13px",
                  borderRadius: 16,
                  background: "#eef5f4",
                  border: `1px solid ${D.cardBorder}`,
                  fontSize: 12,
                  fontWeight: 600,
                  color: D.muted,
                }}
              >
                {kpi.year}
              </span>
            </span>
          }
        >
          <MonthChart months={months} />
        </SectionCard>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Target Achieved + Current Portfolio                                 */}
      {/* ------------------------------------------------------------------ */}
      <div style={splitRow}>
        <SectionCard icon={TargetIcon} title="Target Achieved" padding="20px 22px 24px">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {(
              [
                { label: "MTD", actual: kpi.mtd.revenue, target: kpi.mtdTargets.revenue },
                { label: "YTD", actual: kpi.ytd.revenue, target: kpi.ytdTargets.revenue },
              ] as const
            ).map((cell) => {
              const ratio = cell.target > 0 ? cell.actual / cell.target : 0;
              return (
                <div
                  key={cell.label}
                  title={`${formatMoney(cell.actual)} of ${formatMoney(cell.target)}`}
                  style={{
                    background: "#f3faf9",
                    border: "1px solid #e6f1f0",
                    borderRadius: 10,
                    padding: "16px 14px 20px",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.4px", color: D.body }}
                  >
                    {cell.label}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 12,
                      minWidth: 0,
                    }}
                  >
                    <Ring
                      percent={Math.min(ratio * 100, 100)}
                      label={`${(ratio * 100).toFixed(2)}%`}
                      color={ratio >= 1 ? D.teal : D.red}
                      trackColor={D.targetTrack}
                      viewBox={112}
                      radius={45}
                      strokeWidth={10}
                      maxWidth={112}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          icon={BriefcaseIcon}
          title="Current Portfolio (YTD)"
          padding="20px 22px 22px"
          headerGap={6}
        >
          {DEAL_CATEGORIES.map((category) => (
            <PortfolioRow
              key={category}
              label={category}
              amount={kpi.portfolio[category] ?? 0}
              max={portfolioMax}
              formatValue={pkrMillions}
            />
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              paddingTop: 16,
              // The call button is fixed to the viewport's bottom-right, so at
              // some scroll position it lands exactly on this figure and hides
              // it. Reserve its footprint (52px + 22px inset, less the card's
              // own padding) only when the button is actually rendered —
              // padding it unconditionally would leave every other user's
              // total sitting oddly short of the edge.
              paddingRight: awaitingAccept[0]?.phone ? 52 : 0,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "1.1px",
                textTransform: "uppercase",
                color: D.axis,
              }}
            >
              Total Portfolio
            </span>
            <span
              title={formatMoney(portfolioTotal)}
              style={{
                fontSize: 19,
                fontWeight: 700,
                letterSpacing: "-0.5px",
                color: D.tealDeep,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {pkrMillions(portfolioTotal)}
            </span>
          </div>
        </SectionCard>
      </div>

      {/* The design's floating call action. It dials the lead most in need of */}
      {/* a call — the one waiting to be accepted — rather than being decor.    */}
      {awaitingAccept[0]?.phone && (
        <a
          href={`tel:${awaitingAccept[0].phone}`}
          aria-label={`Call ${awaitingAccept[0].name}`}
          title={`Call ${awaitingAccept[0].name}`}
          style={{
            position: "fixed",
            right: 22,
            bottom: 26,
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: D.teal,
            boxShadow: "0 10px 24px rgba(31,92,88,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 30,
          }}
        >
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
            <path d={PHONE_PATH} />
          </svg>
        </a>
      )}

      {viewingLead && (
        <LeadDetailModal
          lead={leads.find((lead) => lead.id === viewingLead.id) ?? viewingLead}
          onClose={() => setViewingLead(null)}
          getIdToken={getIdToken}
          userRole={role as "employee" | "admin"}
        />
      )}
    </div>
  );
}
