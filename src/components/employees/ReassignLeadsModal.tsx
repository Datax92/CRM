"use client";

/**
 * Reassign leads — one person's open leads, shared out by number.
 *
 * Built for the day somebody leaves holding a pipeline (owner, 2026-10-01),
 * and just as usable when somebody is simply carrying too much. The admin
 * types how many each person gets; anything not given out stays where it is.
 *
 * The numbers are only a request: `redistributeLeads` finds the leads on the
 * server and refuses a total larger than the person really holds, so the count
 * shown here — taken from the leads this browser has loaded — can be stale
 * without anything going to the wrong place.
 *
 * One component for both widths, on `OverlayPanel`, so it portals and keeps its
 * Save button in reach on a phone.
 */

import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { redistributeLeads } from "@/lib/clientActions";
import { OverlayPanel } from "@/components/ui/OverlayPanel";
import { E } from "@/components/employees/directoryChrome";

export interface ReassignRecipient {
  uid: string;
  name: string;
  /** "Sales Executive", "Manager", "Admin" — who this is, in a word or two. */
  note: string;
  /** Open leads they already hold, so nobody is buried by accident. */
  held: number;
}

export function ReassignLeadsModal({
  source,
  openCount,
  recipients,
  getIdToken,
  onClose,
  onDone,
}: {
  source: { uid: string; name: string };
  openCount: number;
  recipients: ReassignRecipient[];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numberFor = (uid: string) => Math.max(0, Math.floor(Number(counts[uid]) || 0));
  const chosen = recipients.reduce((sum, person) => sum + numberFor(person.uid), 0);
  const left = openCount - chosen;
  const over = left < 0;

  const set = (uid: string, value: string) => {
    setError(null);
    setCounts((current) => ({ ...current, [uid]: value.replace(/[^\d]/g, "") }));
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await redistributeLeads(
        await getIdToken(),
        source.uid,
        recipients
          .map((person) => ({ uid: person.uid, count: numberFor(person.uid) }))
          .filter((share) => share.count > 0)
      );
      if (!result.ok) {
        setError(result.error || "The leads could not be reassigned.");
        return;
      }
      const parts = result.data.moved
        .filter((entry) => entry.count > 0)
        .map((entry) => `${entry.count} to ${entry.name}`);
      const total = result.data.moved.reduce((sum, entry) => sum + entry.count, 0);
      onDone(
        `Reassigned ${total} of ${source.name}'s lead${total === 1 ? "" : "s"} — ${parts.join(", ")}.` +
          (result.data.remaining > 0 ? ` ${result.data.remaining} still with ${source.name}.` : "")
      );
    } catch {
      setError("A network error occurred. Some leads may have moved — reopen this to see what is left.");
    } finally {
      setBusy(false);
    }
  };

  const summary =
    openCount === 0
      ? `${source.name} holds no open leads.`
      : over
        ? `${chosen} chosen — ${-left} more than ${source.name} holds`
        : chosen === 0
          ? `${openCount} open lead${openCount === 1 ? "" : "s"} to give out`
          : `${chosen} of ${openCount} chosen · ${left} stay${left === 1 ? "s" : ""} with ${source.name}`;

  return (
    <OverlayPanel
      title={`Reassign ${source.name}'s leads`}
      subtitle={`${openCount} open lead${openCount === 1 ? "" : "s"} · closed leads stay on their record`}
      maxWidth={560}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: over ? E.red : E.muted }}>{summary}</span>
          <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
            <button type="button" onClick={onClose} disabled={busy}
              style={{ borderRadius: 999, border: `1px solid ${E.border}`, background: "#fff", color: E.muted, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
            <button type="button" onClick={() => void submit()} disabled={busy || chosen === 0 || over}
              style={{ borderRadius: 999, border: "none", background: E.tealInk, color: "#fff", padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: busy || chosen === 0 || over ? "default" : "pointer", opacity: busy || chosen === 0 || over ? 0.5 : 1, fontFamily: "inherit", whiteSpace: "nowrap" }}>
              {busy ? "Reassigning…" : chosen > 0 ? `Reassign ${chosen} lead${chosen === 1 ? "" : "s"}` : "Reassign"}
            </button>
          </div>
        </div>
      }
    >
      <p style={{ fontSize: 12.5, lineHeight: 1.6, color: E.muted, fontFamily: E.font }}>
        Type how many each person gets. The leads are dealt out newest first, in turn, so everybody
        gets a share of the fresh ones. Each lead keeps its whole history and goes straight into the
        new person&apos;s pipeline as accepted.
      </p>

      {recipients.length === 0 ? (
        <p style={{ fontSize: 13, fontWeight: 600, color: E.muted, fontFamily: E.font }}>
          There is nobody active to give them to.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8, fontFamily: E.font }}>
          {recipients.map((person) => {
            const value = numberFor(person.uid);
            return (
              <div key={person.uid}
                style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `1px solid ${value > 0 ? E.teal : E.border}`, borderRadius: 14, padding: "10px 12px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: E.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {person.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: E.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {person.note} · holds {person.held} open
                  </div>
                </div>
                {left > 0 && (
                  <button type="button" disabled={busy} onClick={() => set(person.uid, String(value + left))}
                    title={`Give ${person.name} the ${left} not yet given out`}
                    style={{ flexShrink: 0, borderRadius: 999, border: `1px solid ${E.border}`, background: "#fff", color: E.tealInk, padding: "6px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    + rest
                  </button>
                )}
                <input
                  type="text"
                  inputMode="numeric"
                  value={counts[person.uid] ?? ""}
                  placeholder="0"
                  disabled={busy || openCount === 0}
                  aria-label={`Leads for ${person.name}`}
                  onChange={(event) => set(person.uid, event.target.value)}
                  style={{ flexShrink: 0, width: 76, borderRadius: 10, border: `1px solid ${E.border}`, background: "#fff", color: E.ink, padding: "8px 10px", fontSize: isMobile ? 16 : 14, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums", outline: "none", fontFamily: "inherit" }}
                />
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p role="alert" style={{ borderRadius: 12, background: "#fdeeec", border: "1px solid #f0c4bd", padding: "10px 13px", fontSize: 12.5, fontWeight: 600, color: "#a33a29", fontFamily: E.font }}>
          {error}
        </p>
      )}
    </OverlayPanel>
  );
}
