"use client";

/**
 * Closed Deals — the complete historical record of finalised deals (§7).
 *
 * **A deal arrives here when the admin finalises its profit split.** Until then
 * it sits in Profit Distribution waiting to be settled. That is what "move the
 * deal to Closed Deals" means in practice, and the two screens divide by state
 * rather than by data: they read the same `closedDeals` collection.
 *
 * The filter defaults to Settled for that reason — but **Awaiting split and All
 * are one click away**, because a deal that has been closed and not yet split
 * is real money the business has taken, and a screen that simply omitted it
 * would look like the record had lost something. Nothing is hidden; the default
 * is just the finished half.
 *
 * Opening a row gives the whole record: client and KYC, the lead and where it
 * came from, employee and manager, amounts, the split, and the history. See
 * `ClosedDealRecord` for how that is assembled without copying anything.
 */

import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEmployees, useSubAdmins } from "@/hooks/useEmployees";
import { useFinancials, type DealRecord } from "@/hooks/useFinancials";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { ClosedDealRecord } from "@/components/financials/ClosedDealRecord";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, resolveRange, RANGE_LABELS, type RangeKey } from "@/lib/dates";
import { describeLeadSource } from "@/lib/leadSource";
import { Search, Handshake, X, ChevronRight, Clock, CheckCircle2, Layers } from "lucide-react";

const T = {
  ink: "#1f3b39",
  muted: "#5b6d6b",
  faint: "#9aacaa",
  line: "#dceae8",
  hair: "#f0f6f5",
  surface: "#ffffff",
  ground: "#f3faf9",
  teal: "#2f7d78",
  tealMid: "#3f8f8a",
  tealSoft: "#e2f0ee",
  amber: "#a4682a",
  amberSoft: "#fdf1e3",
};

type StateFilter = "SETTLED" | "AWAITING" | "ALL";

const STATE_FILTERS: Array<{ key: StateFilter; label: string; icon: typeof Clock }> = [
  { key: "SETTLED", label: "Settled", icon: CheckCircle2 },
  { key: "AWAITING", label: "Awaiting split", icon: Clock },
  { key: "ALL", label: "All", icon: Layers },
];

const PAGE_SIZE = 12;

/** Absent means pending: a deal closed before the split existed is not settled. */
const isSettled = (deal: DealRecord) => deal.distributionStatus === "FINALIZED";

export default function ClosedDealsPage() {
  const { role, loading: authLoading } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";
  // A phone gets the same rows with the money under the name rather than
  // beside it: at 390px a name, a manager, a source, a date and two figures on
  // one line leaves nothing legible.
  const isMobile = useIsMobile();

  const [rangeKey, setRangeKey] = useState<RangeKey>("ALL");
  const range = useMemo(() => resolveRange(rangeKey), [rangeKey]);

  const { deals, loading, error } = useFinancials(range, isAdmin);
  const { employees } = useEmployees(isAdmin);
  const { subAdmins } = useSubAdmins(isAdmin);

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("SETTLED");
  const [employeeFilter, setEmployeeFilter] = useState("ALL");
  const [selected, setSelected] = useState<DealRecord | null>(null);

  const nameOf = useMemo(
    () => new Map([...employees, ...subAdmins].map((person) => [person.uid, person.name])),
    [employees, subAdmins]
  );
  const managerOf = useMemo(
    () => new Map(employees.map((person) => [person.uid, person.subAdminUid ?? null])),
    [employees]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();

    return deals.filter((deal) => {
      if (stateFilter === "SETTLED" && !isSettled(deal)) return false;
      if (stateFilter === "AWAITING" && isSettled(deal)) return false;
      if (employeeFilter !== "ALL" && deal.userId !== employeeFilter) return false;

      if (q) {
        const hay = [
          deal.customer?.name,
          deal.customer?.phone,
          deal.customer?.email,
          deal.customer?.cnic,
          deal.serviceDescription,
          deal.dataBankFolderName,
          deal.campaignName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [deals, query, stateFilter, employeeFilter]);

  const pages = usePagination(visible, PAGE_SIZE);

  // Counts describe the whole period, not the current filter — a number that
  // moved when you clicked a chip would read as the business having shrunk.
  const totals = useMemo(
    () => ({
      settled: deals.filter(isSettled).length,
      awaiting: deals.filter((deal) => !isSettled(deal)).length,
      revenue: deals.reduce((sum, deal) => sum + (deal.amountReceived ?? 0), 0),
      profit: deals.reduce((sum, deal) => sum + (deal.profit ?? 0), 0),
    }),
    [deals]
  );

  if (authLoading || (isAdmin && loading)) return <FullPageSpinner />;
  if (!isAdmin) return null;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px clamp(16px, 3vw, 28px) 40px" }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            aria-hidden
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              borderRadius: 14,
              background: T.tealSoft,
              color: T.teal,
            }}
          >
            <Handshake size={20} />
          </span>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: T.ink }}>Closed Deals</h1>
            <p style={{ fontSize: 13, color: T.faint }}>
              {totals.settled} settled · {totals.awaiting} awaiting a profit split
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <Stat label="Revenue" value={formatMoney(totals.revenue)} />
          <Stat label="Net profit" value={formatMoney(totals.profit)} accent />
        </div>
      </header>

      {error && <Banner tone="error" text={error} />}

      {/* ------------------------------------------------------------------ */}
      {/* Filters                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.line}`,
          borderRadius: 16,
          padding: 14,
          marginBottom: 16,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <label style={{ position: "relative", flex: "1 1 260px", minWidth: 200 }}>
          <Search
            size={15}
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.faint }}
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search client, CNIC, phone, project…"
            aria-label="Search closed deals"
            style={{
              width: "100%",
              borderRadius: 10,
              border: `1px solid ${T.line}`,
              background: T.ground,
              padding: "10px 34px 10px 34px",
              fontSize: 13.5,
              color: T.ink,
              outline: "none",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: T.faint,
                cursor: "pointer",
              }}
            >
              <X size={14} />
            </button>
          )}
        </label>

        <div
          role="tablist"
          aria-label="Settlement state"
          style={{
            display: "flex",
            gap: 4,
            background: T.ground,
            border: `1px solid ${T.line}`,
            borderRadius: 999,
            padding: 3,
            // Scrolls rather than wrapping: three chips on two ragged lines is
            // worse than three chips you can swipe.
            overflowX: "auto",
            maxWidth: "100%",
          }}
        >
          {STATE_FILTERS.map(({ key, label, icon: Icon }) => {
            const on = stateFilter === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={on}
                onClick={() => setStateFilter(key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 999,
                  padding: "7px 13px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  background: on ? T.teal : "transparent",
                  color: on ? "#fff" : T.muted,
                }}
              >
                <Icon size={13} />
                {label}
              </button>
            );
          })}
        </div>

        <select
          value={employeeFilter}
          onChange={(event) => setEmployeeFilter(event.target.value)}
          aria-label="Employee"
          style={{ ...selectStyle, flex: "1 1 150px", minWidth: 0 }}
        >
          <option value="ALL">All employees</option>
          {employees.map((person) => (
            <option key={person.uid} value={person.uid}>
              {person.name}
            </option>
          ))}
        </select>

        <select
          value={rangeKey}
          onChange={(event) => setRangeKey(event.target.value as RangeKey)}
          aria-label="Period"
          style={{ ...selectStyle, flex: "1 1 130px", minWidth: 0 }}
        >
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
            <option key={key} value={key}>
              {RANGE_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The record                                                         */}
      {/* ------------------------------------------------------------------ */}
      {visible.length === 0 ? (
        <p
          style={{
            borderRadius: 16,
            border: `1px dashed ${T.line}`,
            background: "rgba(255,255,255,0.7)",
            padding: "48px 24px",
            textAlign: "center",
            fontSize: 13,
            color: T.faint,
          }}
        >
          {stateFilter === "SETTLED"
            ? "No settled deals in this period. A deal appears here once its profit distribution is finalised."
            : "Nothing matches these filters."}
        </p>
      ) : (
        <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 16, overflow: "hidden" }}>
          {pages.items.map((deal) => {
            const managerUid = deal.subAdminUid ?? managerOf.get(deal.userId ?? "") ?? null;
            const settled = isSettled(deal);

            return (
              <button
                key={deal.id}
                onClick={() => setSelected(deal)}
                style={{
                  display: "flex",
                  alignItems: isMobile ? "flex-start" : "center",
                  gap: isMobile ? 12 : 14,
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 16px",
                  borderBottom: `1px solid ${T.hair}`,
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: T.tealSoft,
                    color: T.teal,
                    fontSize: 13,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {(deal.customer?.name ?? "?").slice(0, 2).toUpperCase()}
                </span>

                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>
                      {deal.customer?.name ?? "Client"}
                    </span>
                    {!settled && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.5px",
                          borderRadius: 999,
                          padding: "2px 8px",
                          background: T.amberSoft,
                          color: T.amber,
                        }}
                      >
                        AWAITING SPLIT
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11.5,
                      color: T.faint,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: isMobile ? "normal" : "nowrap",
                      lineHeight: 1.45,
                    }}
                  >
                    {nameOf.get(deal.userId ?? "") ?? "Unknown employee"}
                    {managerUid ? ` · ${nameOf.get(managerUid) ?? "Manager"}` : ""}
                    {" · "}
                    {describeLeadSource(deal)}
                    {deal.dealDate ? ` · ${formatBusinessDate(deal.dealDate)}` : ""}
                  </span>

                  {/* On a phone the money sits under the name, in the width the
                      name already has, rather than fighting it for the row. */}
                  {isMobile && (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        marginTop: 6,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 700, color: T.teal }}>
                        {formatMoney(deal.amountReceived)}
                      </span>
                      <span style={{ fontSize: 11.5, color: T.faint }}>
                        profit {formatMoney(deal.profit)}
                      </span>
                    </span>
                  )}
                </span>

                {!isMobile && (
                  <span style={{ textAlign: "right", flexShrink: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 14,
                        fontWeight: 700,
                        color: T.teal,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatMoney(deal.amountReceived)}
                    </span>
                    <span
                      style={{ display: "block", fontSize: 11.5, color: T.faint, fontVariantNumeric: "tabular-nums" }}
                    >
                      profit {formatMoney(deal.profit)}
                    </span>
                  </span>
                )}

                <ChevronRight
                  size={16}
                  style={{ color: T.faint, flexShrink: 0, marginTop: isMobile ? 12 : 0 }}
                  aria-hidden
                />
              </button>
            );
          })}

          <div style={{ padding: "10px 16px" }}>
            <Pager pagination={pages} variant="web" noun="deals" />
          </div>
        </div>
      )}

      {selected && (
        <ClosedDealRecord
          deal={selected}
          employeeName={nameOf.get(selected.userId ?? "")}
          managerName={
            nameOf.get(selected.subAdminUid ?? managerOf.get(selected.userId ?? "") ?? "") ?? undefined
          }
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  borderRadius: 10,
  border: `1px solid ${T.line}`,
  background: T.ground,
  padding: "10px 12px",
  fontSize: 13,
  color: T.ink,
  cursor: "pointer",
};

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${T.line}`,
        background: T.surface,
        padding: "10px 16px",
        minWidth: 132,
      }}
    >
      <p style={{ fontSize: 10.5, letterSpacing: "0.6px", textTransform: "uppercase", color: T.faint }}>{label}</p>
      <p
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: accent ? T.teal : T.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
    </div>
  );
}
