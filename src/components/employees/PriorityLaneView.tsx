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
 * **The admin runs the lane from here** (owner, 2026-09-17): who is in the
 * rotation, how many leads each person takes per turn, their priority, and
 * whether automatic ranking may move it. **Managers can be put in the rotation
 * too** — out by default, and badged "Manager" either way, so a manager in the
 * list never reads as an employee. The same predicate the server's roster uses
 * (`laneMembership`) decides the switch, so the screen cannot show somebody in
 * rotation whom distribution skips.
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
import { MAX_LEADS_PER_TURN, normalizeLeadsPerTurn } from "@/lib/distribution";
import { leadScore, leadScoreBreakdown, LEAD_SCORE_WEIGHTS, EMPTY_LEAD_ACTIVITY } from "@/lib/leadPriority";
import { roleTitle } from "@/lib/constants/hierarchy";
import { setEmployeePriority, recalculateEmployeePriorities, updateLaneSettings } from "@/lib/clientActions";

/** What the admin can change about one person's place in the lane, besides the number. */
type LanePatch = { inRotation?: boolean; leadsPerTurn?: number; locked?: boolean };
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
  /** The admin's switch: in the rotation or not. */
  inRotation: boolean;
  /** Whether automatic distribution can actually reach them — in rotation and not paused. */
  inLane: boolean;
  /** Leads they take per turn before the lane moves on. */
  leadsPerTurn: number;
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
  /** Optimistic switches and turn sizes, for the same reason. */
  const [pendingLane, setPendingLane] = useState<Record<string, LanePatch>>({});

  const rows = useMemo<LaneRow[]>(() => {
    const build = (person: EmployeeData, isManager: boolean): LaneRow => {
      const counters = activity[person.uid] ?? EMPTY_LEAD_ACTIVITY;
      const disabled = person.status === "DISABLED";
      const local = pendingLane[person.uid] ?? {};
      /*
        The live mapper already applies `laneMembership`, so a manager's absent
        field arrives as `false`. The role check is kept for demo rows, which do
        not pass through the mapper: a manager is in only when marked in.
      */
      const inRotation =
        local.inRotation ?? (isManager ? person.autoAssign === true : person.autoAssign !== false);
      return {
        uid: person.uid,
        name: person.name,
        role: roleTitle(person),
        isManager,
        disabled,
        priority: pending[person.uid] ?? Number(person.priority ?? MAX_PRIORITY),
        pinned: local.locked ?? person.autoPriority === false,
        inRotation,
        // A paused account receives nothing, whatever its switch says.
        inLane: inRotation && !disabled,
        leadsPerTurn: normalizeLeadsPerTurn(local.leadsPerTurn ?? person.leadsPerTurn),
        ...counters,
        score: leadScore(counters),
      };
    };

    return [
      ...employees.map((employee) => build(employee, false)),
      ...subAdmins.map((manager) => build(manager, true)),
    ].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [employees, subAdmins, activity, pending, pendingLane]);

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
        text: `${name} is locked at priority ${value}. Automatic ranking will leave them there.`,
      };
    });
  };

  const saveLane = (uid: string, name: string, patch: LanePatch) => {
    setPendingLane((current) => ({ ...current, [uid]: { ...current[uid], ...patch } }));
    return run(async (token) => {
      const result = await updateLaneSettings(token, uid, patch);
      if (!result.ok) {
        setPendingLane((current) => {
          const next = { ...current };
          delete next[uid];
          return next;
        });
        return { ok: false, text: result.error || "Could not change that." };
      }
      const text =
        patch.inRotation !== undefined
          ? patch.inRotation
            ? `${name} is in the rotation and will be offered leads in turn.`
            : `${name} is out of the rotation. They can still be handed a lead by hand.`
          : patch.leadsPerTurn !== undefined
            ? `${name} now takes ${patch.leadsPerTurn} ${patch.leadsPerTurn === 1 ? "lead" : "leads"} per turn.`
            : patch.locked
              ? `${name}'s priority is locked. Automatic ranking will leave it alone.`
              : `${name}'s priority is unlocked. The next ranking may move it.`;
      return { ok: true, text };
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
              Everyone in the rotation takes <strong>their own number of leads per turn</strong>, in
              priority order — 1, then 2, then 3 — and back to the top. Whoever is offered one has{" "}
              <strong>{ACCEPT_WINDOW_MINUTES} minutes</strong> to accept before it passes on.
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
          <strong>passed leads × {LEAD_SCORE_WEIGHTS.pass}</strong>, this month. Re-ranking gives
          the highest score priority 1 — except anybody whose priority is <strong>locked</strong>.
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
            onLane={(patch) => void saveLane(row.uid, row.name, patch)}
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
  onLane,
}: {
  row: LaneRow;
  rank: number;
  best: number;
  isMobile: boolean;
  busy: boolean;
  onSave: (value: number) => void;
  onLane: (patch: LanePatch) => void;
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
            {row.isManager && <Chip icon={<Users size={10} />} text="Manager" tone="muted" />}
            {row.disabled ? (
              <Chip text="Paused — no leads" tone="muted" />
            ) : !row.inRotation ? (
              <Chip text="Not in rotation" tone="muted" />
            ) : (
              <Chip
                icon={<Gauge size={10} />}
                text={`Priority ${row.priority} · ${row.leadsPerTurn} per turn`}
                tone="teal"
              />
            )}
            {row.pinned && row.inLane && <Chip icon={<Lock size={10} />} text="Locked" tone="warn" />}
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

        {!isMobile && <LaneControls row={row} busy={busy} onSave={onSave} onLane={onLane} />}
      </div>

      {isMobile && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${E.rowBorder}` }}>
          <LaneControls row={row} busy={busy} onSave={onSave} onLane={onLane} full />
        </div>
      )}
    </Card>
  );
}

/**
 * The admin's four controls for one person: in the rotation, leads per turn,
 * priority, and the lock that keeps automatic ranking off that priority.
 *
 * Every select reads its value synchronously, before anything awaits. A
 * controlled select is re-rendered back to its prop the moment an async handler
 * yields, so an `await` first would send the *old* value — the bug recorded in
 * CLAUDE.md's Lessons.
 */
function LaneControls({
  row,
  onSave,
  onLane,
  busy,
  full,
}: {
  row: LaneRow;
  onSave: (value: number) => void;
  onLane: (patch: LanePatch) => void;
  busy: boolean;
  full?: boolean;
}) {
  const selectStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    border: `1px solid ${E.border}`,
    background: E.field,
    padding: "8px 10px",
    // 16 on the phone, or iOS Safari zooms on focus.
    fontSize: full ? 16 : 13,
    fontWeight: 600,
    color: E.ink,
    fontFamily: "inherit",
    cursor: busy ? "default" : "pointer",
  };
  // Turn size and priority only matter to somebody the lane can reach.
  const dim = row.inLane ? 1 : 0.55;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flexShrink: 0,
        width: full ? "100%" : 236,
      }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={row.inRotation}
        disabled={busy}
        onClick={() => onLane({ inRotation: !row.inRotation })}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "8px 12px",
          borderRadius: 10,
          border: `1px solid ${row.inRotation ? E.teal : E.border}`,
          background: row.inRotation ? E.tealTint : E.field,
          color: row.inRotation ? E.deep : E.muted,
          fontSize: full ? 15 : 13,
          fontWeight: 700,
          fontFamily: "inherit",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {row.inRotation ? "In rotation" : "Not in rotation"}
        <span
          aria-hidden
          style={{
            position: "relative",
            width: 34,
            height: 20,
            borderRadius: 999,
            background: row.inRotation ? E.teal : E.hair,
            flexShrink: 0,
            transition: "background 220ms",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: 2,
              width: 16,
              height: 16,
              borderRadius: 999,
              background: "#fff",
              transform: row.inRotation ? "translateX(14px)" : "none",
              transition: "transform 220ms",
            }}
          />
        </span>
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: dim }}>
        <select
          value={row.leadsPerTurn}
          onChange={(event) => onLane({ leadsPerTurn: Number(event.target.value) })}
          disabled={busy}
          aria-label="Leads per turn"
          style={selectStyle}
        >
          {Array.from({ length: MAX_LEADS_PER_TURN }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "lead" : "leads"} per turn
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: dim }}>
        <select
          value={row.priority}
          onChange={(event) => onSave(Number(event.target.value))}
          disabled={busy}
          aria-label="Set lane priority"
          style={selectStyle}
        >
          {Array.from({ length: MAX_PRIORITY - MIN_PRIORITY + 1 }, (_, i) => MIN_PRIORITY + i).map((n) => (
            <option key={n} value={n}>
              Priority {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={row.pinned}
          aria-label={row.pinned ? "Unlock priority" : "Lock priority"}
          title={
            row.pinned
              ? "Locked — automatic ranking leaves this priority alone. Click to unlock."
              : "Ranked automatically. Click to lock this priority."
          }
          disabled={busy}
          onClick={() => onLane({ locked: !row.pinned })}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: full ? 42 : 36,
            height: full ? 42 : 36,
            borderRadius: 10,
            border: `1px solid ${row.pinned ? E.amberInk : E.border}`,
            background: row.pinned ? E.amberBg : E.field,
            cursor: busy ? "default" : "pointer",
            flexShrink: 0,
          }}
        >
          {row.pinned ? <Lock size={15} color={E.amberInk} /> : <Unlock size={15} color={E.faint} />}
        </button>
      </div>
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
