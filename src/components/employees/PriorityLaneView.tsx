"use client";

/**
 * The lead lane — who is first in line for the next lead, and why.
 *
 * **Built in the directory's language**, on `directoryChrome`'s `E` tokens and
 * its `Card` / `Bar` / `HeroRings`, because this screen and the Team screen
 * describe the same people. It was a slate-and-indigo table from an earlier era
 * of the app, which made it read as somebody else's page.
 *
 * **The order is earned, and the card says how.** Each person's score is
 * `connects × 2 + follow-ups − passes × 2` for the current month, from the same
 * documents `recalcPriorities` ranks on, so the screen can always explain the
 * order the nightly job produced rather than presenting a position that has to
 * be taken on trust.
 *
 * **Managers are ranked but not in the lane** — the owner's instruction. They
 * appear with their numbers so everyone can be compared, and automatic
 * distribution still only reaches employees. Saying so on the card is the point:
 * a manager sitting in a ranked list with no badge reads as somebody about to be
 * handed leads.
 *
 * **Sorted by score, not by the priority they currently hold.** This screen
 * answers "who has earned the front of the queue"; stored-priority order would
 * hide exactly the disagreement an admin opens it to find — somebody sitting at
 * priority 1 having done nothing this month.
 *
 * One implementation, two surfaces: the phone gets cards rather than a table,
 * because a lane with a control per row is unreadable at 390px.
 */

import { useMemo, useState } from "react";
import { Crown, Gauge, Lock, RefreshCw, Search, Sparkles, Unlock, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEmployees, useSubAdmins, type EmployeeData } from "@/hooks/useEmployees";
import { useLaneActivity } from "@/hooks/useLaneActivity";
import { MIN_PRIORITY, MAX_PRIORITY, ACCEPT_WINDOW_MINUTES } from "@/lib/constants/distribution";
import { LEADS_PER_TURN } from "@/lib/distribution";
import { leadScore, leadScoreBreakdown, LEAD_SCORE_WEIGHTS, EMPTY_LEAD_ACTIVITY } from "@/lib/leadPriority";
import { roleTitle } from "@/lib/constants/hierarchy";
import { setEmployeePriority, recalculateEmployeePriorities } from "@/lib/clientActions";
import { FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { E, Card, Bar, HeroRings } from "./directoryChrome";

/** One row of the lane, whoever they are. */
interface LaneRow {
  uid: string;
  name: string;
  role: string;
  isManager: boolean;
  disabled: boolean;
  priority: number;
  pinned: boolean;
  /** Whether automatic distribution can actually reach them. */
  inLane: boolean;
  connects: number;
  followUps: number;
  passes: number;
  score: number;
}

export function PriorityLaneView() {
  const { role, getIdToken } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";
  const isMobile = useIsMobile();

  const { employees, loading: empLoading, error } = useEmployees(isAdmin);
  const { subAdmins, loading: mgrLoading } = useSubAdmins(isAdmin);

  const roster = useMemo(
    () => [...employees, ...subAdmins],
    [employees, subAdmins]
  );
  const uids = useMemo(() => roster.map((person) => person.uid), [roster]);
  const { activity, loading: activityLoading } = useLaneActivity(uids, isAdmin);

  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  /** Optimistic priorities, so a select does not snap back while the write flies. */
  const [pending, setPending] = useState<Record<string, number>>({});

  const rows = useMemo<LaneRow[]>(() => {
    const build = (person: EmployeeData, isManager: boolean): LaneRow => {
      const counters = activity[person.uid] ?? EMPTY_LEAD_ACTIVITY;
      const disabled = person.status === "DISABLED";
      return {
        uid: person.uid,
        name: person.name,
        role: roleTitle(person),
        isManager,
        disabled,
        priority: pending[person.uid] ?? Number(person.priority ?? MAX_PRIORITY),
        pinned: person.autoPriority === false,
        /*
          Three ways out of the lane and all three are real: a manager is never
          auto-assigned, a paused account receives nothing, and `autoAssign:
          false` is somebody deliberately taken out of distribution while still
          able to be handed a lead by hand.
        */
        inLane: !isManager && !disabled && person.autoAssign !== false,
        ...counters,
        score: leadScore(counters),
      };
    };

    return [
      ...employees.map((employee) => build(employee, false)),
      ...subAdmins.map((manager) => build(manager, true)),
    ].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [employees, subAdmins, activity, pending]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) => row.name.toLowerCase().includes(needle) || row.role.toLowerCase().includes(needle)
    );
  }, [rows, search]);

  const totals = useMemo(
    () => ({
      inLane: rows.filter((row) => row.inLane).length,
      connects: rows.reduce((sum, row) => sum + row.connects, 0),
      followUps: rows.reduce((sum, row) => sum + row.followUps, 0),
      passes: rows.reduce((sum, row) => sum + row.passes, 0),
    }),
    [rows]
  );

  /** The best score on the board, so the bars compare people to the leader. */
  const best = rows.reduce((top, row) => Math.max(top, row.score), 0);

  const run = async (work: (token: string) => Promise<{ ok: boolean; text: string }>) => {
    setBusy(true);
    try {
      const outcome = await work(await getIdToken());
      setBanner({ tone: outcome.ok ? "success" : "error", text: outcome.text });
    } catch {
      setBanner({ tone: "error", text: "Network error — nothing was changed." });
    } finally {
      setBusy(false);
    }
  };

  const savePriority = (uid: string, name: string, value: number) => {
    setPending((current) => ({ ...current, [uid]: value }));
    return run(async (token) => {
      const result = await setEmployeePriority(token, uid, value);
      if (!result.ok) {
        setPending((current) => {
          const next = { ...current };
          delete next[uid];
          return next;
        });
        return { ok: false, text: result.error || "Could not set that priority." };
      }
      return {
        ok: true,
        text: `${name} is pinned at priority ${value}. Automatic ranking will leave them there.`,
      };
    });
  };

  const recalculate = () =>
    run(async (token) => {
      const result = await recalculateEmployeePriorities(token);
      if (!result.ok) return { ok: false, text: result.error || "Could not re-rank the lane." };
      // Clear the optimistic layer: the server has just rewritten every
      // automatic priority, and a stale local value would sit on top of it.
      setPending({});
      return {
        ok: true,
        text: result.data.changes.length
          ? `Lane re-ranked — ${result.data.changes.length} ${
              result.data.changes.length === 1 ? "person" : "people"
            } moved.`
          : "Lane re-ranked. Nobody moved; the order already matched the numbers.",
      };
    });

  if (empLoading || mgrLoading || activityLoading) return <FullPageSpinner />;

  return (
    <div
      style={{
        // The shell owns the page padding; this screen bleeds to the edge the
        // way every other directory screen does.
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
      {/* ---------------------------------------------------------------- */}
      {/* The hero — what the lane is, and how it is decided               */}
      {/* ---------------------------------------------------------------- */}
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
        <div
          style={{
            position: "relative",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", opacity: 0.85 }}>
              LEAD PRIORITY
            </p>
            <h1
              style={{
                // Inline, because `@layer base` sets a family on h1–h6 and an
                // element rule beats a family inherited from a container.
                fontFamily: E.font,
                fontSize: isMobile ? 25 : 31,
                fontWeight: 800,
                letterSpacing: "-0.9px",
                marginTop: 2,
                color: "#fff",
              }}
            >
              Who gets the next lead
            </h1>
            <p style={{ fontSize: 12.5, opacity: 0.92, marginTop: 6, maxWidth: 560, lineHeight: 1.6 }}>
              Priority 1 takes the next <strong>{LEADS_PER_TURN}</strong> leads, then the lane moves
              down. Whoever is offered one has <strong>{ACCEPT_WINDOW_MINUTES} minutes</strong> to
              accept before it passes on.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void recalculate()}
            disabled={busy}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "11px 20px",
              borderRadius: 999,
              background: "#fff",
              color: E.deep,
              border: "none",
              fontSize: 13.5,
              fontWeight: 700,
              fontFamily: "inherit",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <RefreshCw size={15} />
            {busy ? "Working…" : "Re-rank now"}
          </button>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            flexWrap: "wrap",
            gap: isMobile ? 20 : 34,
            marginTop: 18,
          }}
        >
          <HeroStat label="IN THE LANE" value={totals.inLane} />
          <HeroStat label="CONNECTS" value={totals.connects} />
          <HeroStat label="FOLLOW-UPS" value={totals.followUps} />
          <HeroStat label="PASSED ON" value={totals.passes} />
        </div>
      </section>

      {error && <Banner tone="error" text={error} />}
      {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}

      {/* The rule, said once rather than left to be inferred from the order. */}
      <Card style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <Sparkles size={15} style={{ color: E.tealInk, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: E.body, lineHeight: 1.6 }}>
          Score = <strong>connected calls × {LEAD_SCORE_WEIGHTS.connect}</strong> +{" "}
          <strong>follow-ups × {LEAD_SCORE_WEIGHTS.followUp}</strong> −{" "}
          <strong>passed leads × {LEAD_SCORE_WEIGHTS.pass}</strong>, this month. The highest score
          is first in line.
        </span>
      </Card>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: E.surface,
          border: `1px solid ${E.border}`,
          borderRadius: 999,
          padding: "10px 16px",
        }}
      >
        <Search size={16} style={{ color: E.faint, flexShrink: 0 }} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or role"
          aria-label="Search the lane"
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            // 16 on the phone, or iOS Safari zooms the page on focus.
            fontSize: isMobile ? 16 : 13.5,
            fontWeight: 500,
            color: E.ink,
            fontFamily: "inherit",
          }}
        />
      </div>

      <div style={{ display: "grid", gap: 11 }}>
        {filtered.map((row, index) => (
          <LaneCard
            key={row.uid}
            row={row}
            rank={index + 1}
            best={best}
            isMobile={isMobile}
            busy={busy}
            onSave={(value) => void savePriority(row.uid, row.name, value)}
          />
        ))}
        {filtered.length === 0 && (
          <Card style={{ padding: "34px 20px", textAlign: "center" }}>
            <p style={{ fontSize: 13.5, color: E.faint }}>
              {rows.length === 0 ? "Nobody is on the roster yet." : "Nobody matches that search."}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.1px", opacity: 0.8 }}>{label}</p>
      <p
        style={{
          fontSize: 23,
          fontWeight: 800,
          letterSpacing: "-0.6px",
          fontVariantNumeric: "tabular-nums",
          marginTop: 2,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function LaneCard({
  row,
  rank,
  best,
  isMobile,
  busy,
  onSave,
}: {
  row: LaneRow;
  rank: number;
  best: number;
  isMobile: boolean;
  busy: boolean;
  onSave: (value: number) => void;
}) {
  const parts = leadScoreBreakdown(row);
  const share = best > 0 ? Math.round((row.score / best) * 100) : 0;
  const leader = rank === 1 && row.score > 0;

  return (
    <Card style={{ padding: isMobile ? "14px 15px" : "16px 18px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "38px minmax(0,1fr)" : "44px minmax(0,1fr) auto",
          alignItems: "center",
          gap: isMobile ? 12 : 16,
        }}
      >
        {/* Where they stand on the board. */}
        <div
          style={{
            width: isMobile ? 38 : 44,
            height: isMobile ? 38 : 44,
            borderRadius: 14,
            background: leader ? E.tealTint : E.tint,
            color: leader ? E.deep : E.tealInk,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {leader ? <Crown size={18} /> : rank}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: isMobile ? 14.5 : 15.5,
                fontWeight: 800,
                color: E.ink,
                letterSpacing: "-0.3px",
              }}
            >
              {row.name}
            </span>
            {row.pinned && !row.isManager && <Chip icon={<Lock size={10} />} text="Pinned" tone="warn" />}
            {row.isManager ? (
              <Chip icon={<Users size={10} />} text="Not in the lane" tone="muted" />
            ) : row.disabled ? (
              <Chip text="Paused — no leads" tone="muted" />
            ) : !row.inLane ? (
              <Chip text="Manual only" tone="muted" />
            ) : (
              <Chip icon={<Gauge size={10} />} text={`Priority ${row.priority}`} tone="teal" />
            )}
          </div>
          <p style={{ fontSize: 11.5, color: E.label, marginTop: 3 }}>{row.role}</p>

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 14,
              marginTop: 9,
              flexWrap: "wrap",
            }}
          >
            <Metric label="Connects" value={row.connects} weighted={parts.connects} tone={E.tealInk} />
            <Metric label="Follow-ups" value={row.followUps} weighted={parts.followUps} tone={E.body} />
            {row.passes > 0 && (
              <Metric label="Passed" value={row.passes} weighted={parts.passes} tone={E.amberInk} />
            )}
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.9px", color: E.label }}>
                SCORE
              </p>
              <p
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: row.score > 0 ? E.ink : E.hair,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {row.score}
              </p>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <Bar percent={share} fill={leader ? E.teal : E.light} height={6} minWidth={0} />
          </div>
        </div>

        {/* A manager has no lane position, so there is nothing to pin them at. */}
        {!isMobile && !row.isManager && (
          <PriorityControl value={row.priority} busy={busy} pinned={row.pinned} onSave={onSave} />
        )}
      </div>

      {isMobile && !row.isManager && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${E.rowBorder}` }}>
          <PriorityControl value={row.priority} busy={busy} pinned={row.pinned} onSave={onSave} full />
        </div>
      )}
    </Card>
  );
}

function PriorityControl({
  value,
  onSave,
  busy,
  pinned,
  full,
}: {
  value: number;
  onSave: (value: number) => void;
  busy: boolean;
  pinned: boolean;
  full?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        width: full ? "100%" : undefined,
      }}
    >
      <select
        value={value}
        onChange={(event) => {
          /*
            Read synchronously, before anything awaits. A controlled select is
            re-rendered back to its prop the moment an async handler yields, so
            an `await` first would send the *old* value — the bug recorded in
            CLAUDE.md's Lessons.
          */
          onSave(Number(event.target.value));
        }}
        disabled={busy}
        aria-label="Set lane priority"
        style={{
          flex: full ? 1 : undefined,
          borderRadius: 10,
          border: `1px solid ${E.border}`,
          background: E.field,
          padding: "9px 12px",
          // 16 on the phone, or iOS Safari zooms on focus.
          fontSize: full ? 16 : 13.5,
          fontWeight: 600,
          color: E.ink,
          fontFamily: "inherit",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {Array.from({ length: MAX_PRIORITY - MIN_PRIORITY + 1 }, (_, i) => MIN_PRIORITY + i).map((n) => (
          <option key={n} value={n}>
            Priority {n}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        title={pinned ? "Set by hand — automatic ranking leaves this alone" : "Ranked automatically"}
        style={{ display: "flex", flexShrink: 0 }}
      >
        {pinned ? <Lock size={15} color={E.amberInk} /> : <Unlock size={15} color={E.hair} />}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  weighted,
  tone,
}: {
  label: string;
  value: number;
  weighted: number;
  tone: string;
}) {
  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.9px", color: E.label }}>
        {label.toUpperCase()}
      </p>
      <p style={{ fontSize: 13.5, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>
        {value}
        {/* What this column contributed to the score, so the total adds up on screen. */}
        <span style={{ fontSize: 11, fontWeight: 600, color: E.faint, marginLeft: 4 }}>
          {weighted >= 0 ? `+${weighted}` : weighted}
        </span>
      </p>
    </div>
  );
}

function Chip({
  icon,
  text,
  tone,
}: {
  icon?: React.ReactNode;
  text: string;
  tone: "teal" | "warn" | "muted";
}) {
  const palette = {
    teal: { bg: E.tealTint, fg: E.tealInk },
    warn: { bg: E.amberBg, fg: E.amberInk },
    muted: { bg: E.page, fg: E.muted },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        padding: "2px 9px",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.3px",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {text}
    </span>
  );
}
