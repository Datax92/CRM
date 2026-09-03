"use client";

/**
 * Bulk selection and assignment (§9, §10).
 *
 * Pick 25, 50, 75 or 100 rows — or tick them by hand — choose an employee, and
 * they become that employee's leads in one call.
 *
 * **Nothing is duplicated.** Promotion moves a Data Bank row into the pipeline
 * as a lead exactly as the single-row path does, carrying the source, the
 * folder, every custom column and the assignment provenance with it; the row
 * then leaves the folder. §10's "the employee receives those exact leads" is
 * satisfied by there being one record, not two.
 *
 * **The quick counts take from the top of what is on screen**, in the order
 * shown — so "50" means the first fifty of the current search and filter, not
 * fifty arbitrary rows out of forty thousand. A count larger than the page is
 * capped, and the bar says how many it actually took, because silently
 * selecting fewer than asked is how somebody assigns 23 leads believing they
 * assigned 100.
 */

import { useState } from "react";
import { Users, X, Check, ChevronDown } from "lucide-react";
import { promoteDataBankRecords } from "@/lib/clientActions";
import {
  describeAssignee,
  groupAssignOptions,
  type AssignOption,
} from "@/lib/assignTargets";

const T = {
  ink: "#1f3b39",
  muted: "#5b6d6b",
  faint: "#9aacaa",
  line: "#dceae8",
  surface: "#ffffff",
  ground: "#f3faf9",
  teal: "#2f7d78",
  tealSoft: "#e2f0ee",
  red: "#a33a29",
};

/** The quantities §9 names. */
export const BULK_QUANTITIES = [25, 50, 75, 100] as const;

export function BulkPromoteBar({
  selected,
  available,
  assignOptions,
  getIdToken,
  onSelectCount,
  onClear,
  onDone,
  compact = false,
}: {
  /** Ids ticked right now. */
  selected: string[];
  /** How many rows the current filter is showing — the ceiling for a quick pick. */
  available: number;
  /** Employees, managers and "Admin / Myself" — see `lib/assignTargets`. */
  assignOptions: AssignOption[];
  getIdToken: () => Promise<string>;
  /** Take the first `n` visible rows. The parent owns the ordering. */
  onSelectCount: (n: number) => number;
  onClear: () => void;
  onDone: (message: string) => void;
  /** Phone: stack the controls instead of one row. */
  compact?: boolean;
}) {
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promote = async () => {
    if (!assignee) return setError("Choose who these go to.");
    if (selected.length === 0) return setError("Select at least one record.");

    setBusy(true);
    setError(null);
    try {
      const result = await promoteDataBankRecords(await getIdToken(), selected, assignee);
      if (result.ok) {
        const who = describeAssignee(assignOptions, assignee);
        onDone(
          `${result.data.promoted} lead${result.data.promoted === 1 ? "" : "s"} assigned to ${who}.` +
            (result.data.skipped ? ` ${result.data.skipped} were skipped.` : "")
        );
      } else {
        setError(result.error);
      }
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        border: `1px solid ${T.line}`,
        background: T.surface,
        borderRadius: 14,
        padding: "11px 13px",
        display: "flex",
        flexDirection: compact ? "column" : "row",
        alignItems: compact ? "stretch" : "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: T.muted }}>
          Select
        </span>
        {BULK_QUANTITIES.map((quantity) => (
          <button
            key={quantity}
            type="button"
            disabled={busy || available === 0}
            onClick={() => {
              const took = onSelectCount(quantity);
              setError(
                took < quantity
                  ? `Only ${took} record${took === 1 ? "" : "s"} are showing, so ${took} ${took === 1 ? "was" : "were"} selected.`
                  : null
              );
            }}
            style={{
              borderRadius: 999,
              border: `1px solid ${T.line}`,
              background: T.ground,
              padding: "7px 13px",
              fontSize: 12.5,
              fontWeight: 700,
              color: T.muted,
              cursor: available === 0 ? "not-allowed" : "pointer",
              opacity: available === 0 ? 0.5 : 1,
            }}
          >
            {quantity}
          </button>
        ))}

        {selected.length > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              background: T.tealSoft,
              color: T.teal,
              padding: "6px 11px",
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            <Check size={12} />
            {selected.length} selected
            <button type="button" onClick={onClear} aria-label="Clear selection" style={{ cursor: "pointer" }}>
              <X size={12} />
            </button>
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginLeft: compact ? 0 : "auto",
          flexWrap: "wrap",
        }}
      >
        <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <Users size={14} style={{ position: "absolute", left: 11, color: T.faint }} aria-hidden />
          <select
            value={assignee}
            disabled={busy}
            onChange={(event) => setAssignee(event.target.value)}
            aria-label="Assign to"
            style={{
              appearance: "none",
              borderRadius: 10,
              border: `1px solid ${T.line}`,
              background: T.ground,
              padding: "10px 30px 10px 32px",
              fontSize: 13,
              color: T.ink,
              cursor: "pointer",
              minWidth: 190,
            }}
          >
            <option value="">Assign to…</option>
            {groupAssignOptions(assignOptions).map((section) => (
              <optgroup key={section.group} label={section.label}>
                {section.options.map((option) => (
                  <option key={option.uid} value={option.uid}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown size={14} style={{ position: "absolute", right: 10, color: T.faint }} aria-hidden />
        </span>

        <button
          type="button"
          onClick={promote}
          disabled={busy || selected.length === 0 || !assignee}
          style={{
            background: T.teal,
            color: "#fff",
            borderRadius: 999,
            padding: "11px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || selected.length === 0 || !assignee ? "not-allowed" : "pointer",
            opacity: busy || selected.length === 0 || !assignee ? 0.5 : 1,
            flex: compact ? 1 : undefined,
          }}
        >
          {busy ? "Assigning…" : `Assign ${selected.length || ""}`.trim()}
        </button>
      </div>

      {error && (
        <p style={{ flex: "1 1 100%", fontSize: 12, color: T.red, margin: 0 }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
