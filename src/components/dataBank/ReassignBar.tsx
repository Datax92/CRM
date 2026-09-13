"use client";

/**
 * Reassigning from a folder's **Assigned** list — one row or many.
 *
 * The same bar as `BulkPromoteBar` (same quick counts, same select, same
 * button, same `compact` phone form), for the other half of the folder. What it
 * does depends on what each row *is*, and a selection can hold both:
 *
 * | row | to an employee | to a manager |
 * |---|---|---|
 * | a lead | `assignLeadsBulk` — it moves to their pipeline | `assignLeadsBulk` — it becomes the manager's lead |
 * | a row in a manager's Data Bank | `promoteDataBankRecords` — it becomes the employee's lead | `assignRecordsToManager` — it moves to that manager's Data Bank |
 *
 * All four are the existing actions with their existing rules, so reassigning
 * here and reassigning from the leads screen cannot produce different leads:
 * a closed lead is skipped, the lead files under the **recipient's** manager,
 * and a Sales manager can only reach their own team.
 *
 * "Myself" is not offered. The lead actions refuse the admin as a recipient,
 * and taking a lead for yourself is what the Unassigned half's promotion is for.
 */

import { useState } from "react";
import { Users, X, Check, ChevronDown } from "lucide-react";
import {
  assignLeadsBulk,
  assignRecordsToManager,
  promoteDataBankRecords,
} from "@/lib/clientActions";
import { promotionSkipNote } from "@/lib/dataBank";
import { groupAssignOptions, type AssignOption } from "@/lib/assignTargets";
import type { AssignedItem } from "@/lib/dataBankAssigned";
import { BULK_QUANTITIES } from "./BulkPromoteBar";

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

/**
 * Sends a reassignment to the right action per row and reports it as one
 * sentence. Exported so the single-row control on each surface can use exactly
 * the dispatch the bar uses.
 */
export async function reassignAssignedItems(
  token: string,
  items: readonly AssignedItem[],
  option: AssignOption
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const leads = items.filter((item) => item.kind === "LEAD").map((item) => item.id);
  const rows = items.filter((item) => item.kind === "HANDOFF").map((item) => item.id);
  const toManager = option.group === "MANAGERS";

  let moved = 0;
  let skipped = 0;
  let duplicates = 0;

  if (leads.length > 0) {
    const res = await assignLeadsBulk(token, leads, option.uid);
    if (!res.ok) return { ok: false, error: res.error };
    moved += res.data.assigned;
    skipped += res.data.skipped;
  }
  if (rows.length > 0) {
    if (toManager) {
      const res = await assignRecordsToManager(token, rows, option.uid);
      if (!res.ok) return { ok: false, error: res.error };
      moved += res.data.moved;
      skipped += res.data.skipped;
    } else {
      const res = await promoteDataBankRecords(token, rows, option.uid);
      if (!res.ok) return { ok: false, error: res.error };
      moved += res.data.promoted;
      skipped += res.data.skipped;
      duplicates += res.data.duplicates ?? 0;
    }
  }

  const other = skipped - duplicates;
  return {
    ok: true,
    message:
      `${moved} reassigned to ${option.label}.` +
      (duplicates > 0 ? promotionSkipNote(duplicates, duplicates) : "") +
      (other > 0
        ? ` ${other} skipped — closed, already with ${option.label}, or not on your team.`
        : ""),
  };
}

export function ReassignBar({
  selected,
  available,
  options,
  getIdToken,
  onSelectCount,
  onClear,
  onDone,
  compact = false,
}: {
  /** The rows ticked right now. */
  selected: AssignedItem[];
  /** How many rows the current filter shows — the ceiling for a quick pick. */
  available: number;
  /** Employees and managers this viewer may reassign to — never "Myself". */
  options: AssignOption[];
  getIdToken: () => Promise<string>;
  /** Take the first `n` visible rows. The parent owns the ordering. */
  onSelectCount: (n: number) => number;
  onClear: () => void;
  onDone: (message: string) => void;
  compact?: boolean;
}) {
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const option = options.find((entry) => entry.uid === recipient);
    if (!option) return setError("Choose who these go to.");
    if (selected.length === 0) return setError("Select at least one row.");

    setBusy(true);
    setError(null);
    try {
      const result = await reassignAssignedItems(await getIdToken(), selected, option);
      if (result.ok) onDone(result.message);
      else setError(result.error);
    } catch {
      setError("Could not reach the server. Nothing may have changed — check the list and try again.");
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || selected.length === 0 || !recipient;

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
        flexShrink: 0,
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
                  ? `Only ${took} row${took === 1 ? "" : "s"} are showing, so ${took} ${took === 1 ? "was" : "were"} selected.`
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

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: compact ? 0 : "auto", flexWrap: "wrap" }}>
        <span
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            flex: compact ? "1 1 100%" : undefined,
            minWidth: 0,
          }}
        >
          <Users size={14} style={{ position: "absolute", left: 11, color: T.faint }} aria-hidden />
          <select
            value={recipient}
            disabled={busy}
            onChange={(event) => setRecipient(event.target.value)}
            aria-label="Reassign to"
            style={{
              appearance: "none",
              borderRadius: 10,
              border: `1px solid ${T.line}`,
              background: T.ground,
              padding: "10px 30px 10px 32px",
              // 16px on the phone, or iOS Safari zooms the page on focus.
              fontSize: compact ? 16 : 13,
              color: T.ink,
              cursor: "pointer",
              minWidth: 190,
              flex: compact ? 1 : undefined,
            }}
          >
            <option value="">Reassign to…</option>
            {groupAssignOptions(options).map((section) => (
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
          onClick={() => void submit()}
          disabled={disabled}
          style={{
            background: T.teal,
            color: "#fff",
            borderRadius: 999,
            padding: "11px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            flex: compact ? 1 : undefined,
          }}
        >
          {busy ? "Reassigning…" : `Reassign ${selected.length || ""}`.trim()}
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
