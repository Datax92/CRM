"use client";

/**
 * The management layer, on the directory the admin already uses (§4–§7).
 *
 * **A manager is not an employee**, so they are not in the roster table below
 * this panel and they are not created by the Add Employee form. They get their
 * own card, their own form (`ManagerFormModal`), and figures that are the sum
 * of their team's — a manager takes no leads, so they have no numbers of their
 * own to show. See `lib/managerMetrics` for why that is derived rather than
 * stored.
 *
 * Ticking somebody off a team returns them to the admin rather than to another
 * manager. Silently handing a person to a third party is not a decision this
 * screen is entitled to make on the admin's behalf.
 *
 * **The card opens the manager's dossier**, the same way an employee row opens
 * theirs — `EmployeeDetailModal` with the manager's team, so the leads, deals,
 * activity and analytics are the ones the admin already knows from an employee,
 * read over the whole team. Edit stays its own button: a card that both opened
 * a record and edited it, depending on where you clicked, is a card that edits
 * things by accident.
 */

import { useMemo, useState } from "react";
import { Users, Plus, Pencil, FolderOpen, TrendingUp } from "lucide-react";
import { buildAllManagerMetrics } from "@/lib/managerMetrics";
import { formatCompactMoney } from "@/lib/money";
import { ManagerFormModal } from "./ManagerFormModal";
import type { EmployeeMetrics } from "@/lib/metrics";
import type { DataBankFolder } from "@/hooks/useDataBank";

const E = {
  ink: "#1f3b39",
  muted: "#5b6d6b",
  faint: "#9aacaa",
  border: "#dceae8",
  soft: "#f2f8f7",
  surface: "#ffffff",
  teal: "#2f7d78",
  tealSoft: "#e2f0ee",
};

export function SubAdminPanel({
  subAdmins,
  employees,
  folders,
  getIdToken,
  onResult,
  onOpen,
}: {
  subAdmins: EmployeeMetrics[];
  employees: EmployeeMetrics[];
  /** Only to say how many folders each manager holds — assigned in the Data Bank. */
  folders: DataBankFolder[];
  getIdToken: () => Promise<string>;
  onResult: (banner: { tone: "success" | "error"; text: string }) => void;
  /** Opens the manager's dossier. Absent leaves the cards read-only. */
  onOpen?: (manager: EmployeeMetrics) => void;
}) {
  const [formFor, setFormFor] = useState<{ manager: EmployeeMetrics | null } | null>(null);

  // Every manager's totals in one pass, bucketed by `subAdminUid`. Recomputed
  // from the same employee metrics the roster below renders, so the two can
  // never disagree, and moving somebody between teams moves their numbers on
  // the next render with nothing to recalculate.
  const totals = useMemo(
    () => buildAllManagerMetrics(subAdmins, employees),
    [subAdmins, employees]
  );

  const byUid = useMemo(() => new Map(totals.map((row) => [row.uid, row])), [totals]);

  return (
    <>
      <section
        style={{
          background: E.surface,
          border: `1px solid ${E.border}`,
          borderRadius: 18,
          overflow: "hidden",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            padding: "16px 20px",
            borderBottom: `1px solid ${E.border}`,
          }}
        >
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: E.ink }}>
              <Users size={15} style={{ color: E.teal }} /> Managers
              <span
                style={{ background: E.tealSoft, color: E.teal, borderRadius: 999, padding: "1px 8px", fontSize: 11 }}
              >
                {subAdmins.length}
              </span>
            </h2>
            <p style={{ marginTop: 3, fontSize: 11.5, color: E.faint }}>
              Figures are the sum of each manager&rsquo;s team.{" "}
              {onOpen ? "Open a card for the full record. " : ""}Data Bank folders are assigned from
              the Data Bank.
            </p>
          </div>

          <button
            onClick={() => setFormFor({ manager: null })}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: E.teal,
              color: "#fff",
              borderRadius: 999,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Plus size={15} strokeWidth={2.4} /> Add Manager
          </button>
        </div>

        {subAdmins.length === 0 ? (
          <p style={{ padding: "26px 20px", fontSize: 12.5, color: E.faint, textAlign: "center" }}>
            No managers yet. A manager runs a team of employees and a set of Data Bank folders — they
            do not work leads themselves.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
              gap: 14,
              padding: 18,
            }}
          >
            {subAdmins.map((manager) => {
              const figures = byUid.get(manager.uid);
              const team = figures?.team ?? [];
              const owned = folders.filter((folder) => folder.subAdminUid === manager.uid);

              return (
                <article
                  key={manager.uid}
                  role={onOpen ? "button" : undefined}
                  tabIndex={onOpen ? 0 : undefined}
                  aria-label={onOpen ? `Open ${manager.name}'s record` : undefined}
                  onClick={onOpen ? () => onOpen(manager) : undefined}
                  onKeyDown={
                    onOpen
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onOpen(manager);
                          }
                        }
                      : undefined
                  }
                  style={{
                    border: `1px solid ${E.border}`,
                    borderRadius: 14,
                    padding: "14px 16px",
                    background: E.soft,
                    cursor: onOpen ? "pointer" : "default",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: E.ink,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {manager.name}
                        {manager.status === "DISABLED" && (
                          <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 700, color: "#a4682a" }}>
                            INACTIVE
                          </span>
                        )}
                      </p>
                      <p
                        style={{
                          fontSize: 11.5,
                          color: E.faint,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {manager.email}
                      </p>
                    </div>

                    <button
                      onClick={(event) => {
                        // The card is clickable now; without this the dossier
                        // opens behind the form and two backdrops stack.
                        event.stopPropagation();
                        setFormFor({ manager });
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        border: `1px solid ${E.border}`,
                        background: E.surface,
                        borderRadius: 999,
                        padding: "4px 10px",
                        fontSize: 11.5,
                        color: E.teal,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <Pencil size={11} /> Edit
                    </button>
                  </div>

                  {/* The team's totals, not the manager's own — they have none. */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 8,
                      marginTop: 13,
                      paddingTop: 12,
                      borderTop: `1px solid ${E.border}`,
                    }}
                  >
                    <Figure label="Team" value={String(figures?.headcount ?? 0)} />
                    <Figure label="Leads" value={String(figures?.assigned ?? 0)} />
                    <Figure label="Won" value={String(figures?.closedWon ?? 0)} />
                    <Figure
                      label="Revenue"
                      value={formatCompactMoney(figures?.revenue ?? 0).replace("PKR ", "")}
                      accent
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 10,
                      marginTop: 11,
                      fontSize: 11.5,
                      color: E.muted,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <TrendingUp size={11} style={{ color: E.teal }} />
                      {figures?.conversionRate ?? 0}% conversion
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <FolderOpen size={11} style={{ color: E.teal }} />
                      {owned.length} folder{owned.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  {team.length > 0 && (
                    <p style={{ marginTop: 9, fontSize: 11.5, color: E.faint, lineHeight: 1.5 }}>
                      {team.map((person) => person.name).join(", ")}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {formFor && (
        <ManagerFormModal
          manager={formFor.manager}
          employees={employees}
          getIdToken={getIdToken}
          onClose={() => setFormFor(null)}
          onSaved={(message) => {
            setFormFor(null);
            onResult({ tone: "success", text: message });
          }}
        />
      )}
    </>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: accent ? E.teal : E.ink,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.2,
        }}
      >
        {value}
      </p>
      <p style={{ fontSize: 10, letterSpacing: "0.6px", textTransform: "uppercase", color: E.faint }}>{label}</p>
    </div>
  );
}
