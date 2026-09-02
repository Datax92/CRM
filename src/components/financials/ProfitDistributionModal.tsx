"use client";

/**
 * Finalize Profit Distribution — the admin's split screen (§14–§21).
 *
 * Rebuilt to the newer form language used by the Data Bank folder form, the
 * KYC panel and Add Manager: gradient header, sectioned cards on a soft ground,
 * one column on a phone and two above it, and a summary that stays in view
 * while the percentages are being typed.
 *
 * The arithmetic is untouched — `lib/profitDistribution` is still the only
 * thing that turns a percentage into rupees, and the Server Action runs the
 * same function, so this screen cannot show a figure the write would disagree
 * with.
 *
 * Three things drive the layout:
 *
 * 1. **Everything recalculates on the keystroke.** `calculateDistribution` is
 *    called straight from the render body: it is four multiplications, and
 *    memoising it could show a stale rupee figure beside a fresh percentage.
 * 2. **The remainder is shown twice on purpose** — once as what is left, once
 *    inside the company total. "The company got 4%" and "the company also kept
 *    the 91% nobody allocated" are different facts (§20).
 * 3. **Over-allocation is refused, not clamped.** The entered figures survive
 *    so the admin can see which one to change, and Finalize stays disabled.
 */

import { useState } from "react";
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Building2,
  UserCheck,
  Users,
  RotateCcw,
  PieChart,
  Wallet,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import {
  calculateDistribution,
  parsePercentage,
  DEFAULT_COMPANY_PERCENTAGE,
  DEFAULT_EMPLOYEE_PERCENTAGE,
  DEFAULT_SUBADMIN_PERCENTAGE,
  type DistributionShare,
} from "@/lib/profitDistribution";
import { finalizeProfitDistribution } from "@/lib/clientActions";
import type { DealRecord } from "@/hooks/useFinancials";
import type { EmployeeData } from "@/hooks/useEmployees";

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
  red: "#a33a29",
  redSoft: "#fdeeeb",
  redLine: "#f0c4bd",
};

export interface ProfitDistributionModalProps {
  deal: DealRecord;
  employees: EmployeeData[];
  subAdmins: EmployeeData[];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function ProfitDistributionModal({
  deal,
  employees,
  subAdmins,
  getIdToken,
  onClose,
  onDone,
}: ProfitDistributionModalProps) {
  const employee = employees.find((person) => person.uid === deal.userId) ?? null;
  // The employee's own manager, read off the employee rather than off the deal,
  // so a team change since the sale is reflected. The deal's own stamp is the
  // fallback for a deal closed before the hierarchy existed.
  const ownSubAdminUid = employee?.subAdminUid ?? deal.subAdminUid ?? null;
  const ownSubAdmin = subAdmins.find((person) => person.uid === ownSubAdminUid) ?? null;

  const [employeePct, setEmployeePct] = useState(String(DEFAULT_EMPLOYEE_PERCENTAGE));
  const [ownSubPct, setOwnSubPct] = useState(ownSubAdmin ? String(DEFAULT_SUBADMIN_PERCENTAGE) : "0");
  const [otherSubUid, setOtherSubUid] = useState<string>("");
  const [otherSubPct, setOtherSubPct] = useState("0");
  const [companyPct, setCompanyPct] = useState(String(DEFAULT_COMPANY_PERCENTAGE));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherSubAdmin = subAdmins.find((person) => person.uid === otherSubUid) ?? null;

  const shares: DistributionShare[] = [
    {
      recipientUid: employee?.uid ?? deal.userId ?? null,
      recipientName: employee?.name ?? "Employee",
      recipientRole: "employee",
      kind: "EMPLOYEE",
      percentage: parsePercentage(employeePct),
    },
    ...(ownSubAdmin
      ? [
          {
            recipientUid: ownSubAdmin.uid,
            recipientName: ownSubAdmin.name,
            recipientRole: "subadmin" as const,
            kind: "OWN_SUBADMIN" as const,
            percentage: parsePercentage(ownSubPct),
          },
        ]
      : []),
    ...(otherSubAdmin
      ? [
          {
            recipientUid: otherSubAdmin.uid,
            recipientName: otherSubAdmin.name,
            recipientRole: "subadmin" as const,
            kind: "OTHER_SUBADMIN" as const,
            percentage: parsePercentage(otherSubPct),
          },
        ]
      : []),
    {
      recipientUid: null,
      recipientName: "Company",
      recipientRole: "company",
      kind: "COMPANY_BASE",
      percentage: parsePercentage(companyPct),
    },
  ];

  const result = calculateDistribution(deal.profit ?? 0, shares);
  const amountFor = (kind: string) => result.lines.find((line) => line.kind === kind)?.amount ?? 0;

  const submit = async () => {
    if (!result.valid) return;
    setBusy(true);
    setError(null);

    try {
      const outcome = await finalizeProfitDistribution(
        await getIdToken(),
        deal.id,
        shares.map((share) => ({
          recipientUid: share.recipientUid,
          recipientRole: share.recipientRole,
          kind: share.kind,
          percentage: share.percentage,
        }))
      );

      if (outcome.ok) {
        onDone(
          `Profit distribution finalized. ${formatMoney(outcome.data.distributedAmount)} allocated, ${formatMoney(outcome.data.companyTotalAmount)} to the company.`
        );
      } else {
        setError(outcome.error);
      }
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Finalize profit distribution"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 130,
        background: "rgba(15, 42, 40, 0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "clamp(10px, 3vw, 32px)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 780,
          background: T.ground,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 26px 64px rgba(15,42,40,0.3)",
        }}
      >
        {/* ---------------------------------------------------------------- */}
        {/* Header + deal summary                                            */}
        {/* ---------------------------------------------------------------- */}
        <header
          style={{
            padding: "18px 22px 20px",
            color: "#fff",
            background: `linear-gradient(135deg, ${T.teal} 0%, ${T.tealMid} 100%)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <span
                aria-hidden
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.18)",
                  border: "1.5px solid rgba(255,255,255,0.5)",
                  flexShrink: 0,
                }}
              >
                <PieChart size={19} />
              </span>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>Finalize Profit Distribution</h2>
                <p
                  style={{
                    fontSize: 12.5,
                    opacity: 0.88,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {deal.customer?.name ?? "Client"} · closed by {employee?.name ?? "an employee"}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label="Close"
              style={{ color: "#fff", cursor: "pointer", flexShrink: 0 }}
            >
              <X size={18} />
            </button>
          </div>

          <div className="pd-summary" style={{ marginTop: 18 }}>
            <HeaderFigure label="Payment Received" value={formatMoney(deal.amountReceived)} />
            <HeaderFigure label="Payable Amount" value={formatMoney(deal.payableAmount)} />
            <HeaderFigure label="Net Profit" value={formatMoney(deal.profit)} strong />
          </div>
        </header>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* -------------------------------------------------------------- */}
          {/* The named shares                                               */}
          {/* -------------------------------------------------------------- */}
          <Card
            title="Who gets a share"
            hint="Type a percentage — the amount follows as you type"
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ShareRow
                icon={<UserCheck size={15} />}
                person={employee?.name ?? "Unknown employee"}
                role="Employee — closed this deal"
                value={employeePct}
                onChange={setEmployeePct}
                amount={amountFor("EMPLOYEE")}
                disabled={busy}
              />

              {ownSubAdmin ? (
                <ShareRow
                  icon={<Users size={15} />}
                  person={ownSubAdmin.name}
                  role="Manager — runs this employee's team"
                  value={ownSubPct}
                  onChange={setOwnSubPct}
                  amount={amountFor("OWN_SUBADMIN")}
                  disabled={busy}
                />
              ) : (
                <p
                  style={{
                    borderRadius: 12,
                    border: `1px dashed ${T.line}`,
                    background: T.surface,
                    padding: "12px 14px",
                    fontSize: 12.5,
                    color: T.faint,
                  }}
                >
                  This employee reports to the admin directly, so there is no manager share.
                </p>
              )}

              {/* Optional and the admin's call (§17). It starts as a picker
                  rather than a percentage box for a person nobody has named. */}
              <div
                style={{
                  borderRadius: 12,
                  border: `1px solid ${T.line}`,
                  background: T.surface,
                  padding: "13px 15px",
                }}
              >
                <div className="pd-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                    <Avatar>
                      <Users size={15} />
                    </Avatar>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>Another manager</p>
                      <p style={{ fontSize: 11.5, color: T.faint }}>
                        Optional — someone who helped but does not run this team
                      </p>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <select
                      value={otherSubUid}
                      disabled={busy}
                      onChange={(event) => {
                        setOtherSubUid(event.target.value);
                        // A named person on 0% would read as a bug, so choosing
                        // one seeds a figure the admin can then edit.
                        if (event.target.value && parsePercentage(otherSubPct) === 0) setOtherSubPct("1");
                      }}
                      aria-label="Additional manager"
                      style={{
                        borderRadius: 10,
                        border: `1px solid ${T.line}`,
                        background: T.surface,
                        padding: "9px 11px",
                        fontSize: 13,
                        color: T.ink,
                        cursor: "pointer",
                        maxWidth: 190,
                      }}
                    >
                      <option value="">No-one</option>
                      {subAdmins
                        .filter((person) => person.uid !== ownSubAdminUid)
                        .map((person) => (
                          <option key={person.uid} value={person.uid}>
                            {person.name}
                          </option>
                        ))}
                    </select>

                    {otherSubAdmin && (
                      <>
                        <PercentInput
                          value={otherSubPct}
                          onChange={setOtherSubPct}
                          disabled={busy}
                          label="Additional manager percentage"
                        />
                        <Amount value={amountFor("OTHER_SUBADMIN")} />
                      </>
                    )}
                  </div>
                </div>
              </div>

              <ShareRow
                icon={<Building2 size={15} />}
                person="Company"
                role="Base share — set per deal"
                value={companyPct}
                onChange={setCompanyPct}
                amount={result.companyBaseAmount}
                disabled={busy}
              />
            </div>
          </Card>

          {/* -------------------------------------------------------------- */}
          {/* Live summary                                                   */}
          {/* -------------------------------------------------------------- */}
          <Card title="Distribution summary">
            <dl style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <TotalRow label="Net profit" value={formatMoney(result.netProfit)} />
              <TotalRow
                label="Total distributed"
                sub={`${result.distributedPercentage}%`}
                value={formatMoney(result.distributedAmount)}
              />
              <TotalRow
                label="Remaining"
                sub={`${result.remainingPercentage}%`}
                value={formatMoney(Math.max(0, result.remainingAmount))}
                muted
              />

              {/* A percentage bar, so "how much is still unallocated" is
                  answerable at a glance and not only by reading four numbers. */}
              <div
                aria-hidden
                style={{
                  height: 8,
                  borderRadius: 999,
                  background: T.tealSoft,
                  overflow: "hidden",
                  margin: "2px 0 4px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.max(0, result.distributedPercentage))}%`,
                    background: result.distributedPercentage > 100 ? "#c0563c" : T.teal,
                    transition: "width 120ms linear",
                  }}
                />
              </div>

              <div style={{ height: 1, background: T.line }} />

              <TotalRow
                label="Company total"
                sub="base + remainder"
                value={formatMoney(result.companyTotalAmount)}
                strong
              />
            </dl>

            {result.errors.length > 0 && (
              <p
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  marginTop: 14,
                  borderRadius: 10,
                  border: `1px solid ${T.redLine}`,
                  background: T.redSoft,
                  color: T.red,
                  padding: "10px 12px",
                  fontSize: 12.5,
                  fontWeight: 500,
                }}
              >
                <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
                {result.errors[0]}
              </p>
            )}

            {error && (
              <p
                role="alert"
                style={{
                  marginTop: 10,
                  borderRadius: 10,
                  border: `1px solid ${T.redLine}`,
                  background: T.redSoft,
                  color: T.red,
                  padding: "10px 12px",
                  fontSize: 12.5,
                }}
              >
                {error}
              </p>
            )}
          </Card>
        </div>

        <footer
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 22px",
            borderTop: `1px solid ${T.line}`,
            background: T.surface,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: T.faint }}>
            <Wallet size={13} style={{ color: T.teal }} />
            Finalising moves this deal into Closed Deals.
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{ fontSize: 13, fontWeight: 500, color: T.muted, cursor: "pointer", padding: "9px 14px" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !result.valid}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: T.teal,
                color: "#fff",
                borderRadius: 999,
                padding: "10px 20px",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: busy || !result.valid ? "not-allowed" : "pointer",
                opacity: busy || !result.valid ? 0.5 : 1,
              }}
            >
              <CheckCircle2 size={15} />
              {busy ? "Finalizing…" : "Finalize distribution"}
            </button>
          </div>
        </footer>

        {/* Two rules a media query is genuinely needed for. */}
        <style>{`
          .pd-summary { display: grid; grid-template-columns: 1fr; gap: 10px; }
          .pd-row { display: flex; flex-direction: column; align-items: stretch; gap: 12px; }
          @media (min-width: 560px) {
            .pd-summary { grid-template-columns: repeat(3, 1fr); }
            .pd-row { flex-direction: row; align-items: center; justify-content: space-between; }
          }
        `}</style>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HeaderFigure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      style={{
        borderRadius: 12,
        background: strong ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.12)",
        border: `1px solid rgba(255,255,255,${strong ? 0.45 : 0.22})`,
        padding: "10px 13px",
      }}
    >
      <p style={{ fontSize: 10, letterSpacing: "0.7px", textTransform: "uppercase", opacity: 0.8 }}>{label}</p>
      <p style={{ fontSize: strong ? 17 : 15, fontWeight: strong ? 800 : 600, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </p>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          padding: "11px 16px",
          borderBottom: `1px solid ${T.hair}`,
        }}
      >
        <h3
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: "0.6px",
            textTransform: "uppercase",
            color: T.muted,
          }}
        >
          {title}
        </h3>
        {hint && <span style={{ fontSize: 11.5, color: T.faint }}>{hint}</span>}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

function Avatar({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: 10,
        background: T.tealSoft,
        color: T.teal,
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function ShareRow({
  icon,
  person,
  role,
  value,
  onChange,
  amount,
  disabled,
}: {
  icon: React.ReactNode;
  person: string;
  role: string;
  value: string;
  onChange: (next: string) => void;
  amount: number;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${T.line}`,
        background: T.surface,
        padding: "13px 15px",
      }}
    >
      <div className="pd-row">
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <Avatar>{icon}</Avatar>
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: T.ink,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {person}
            </p>
            <p style={{ fontSize: 11.5, color: T.faint }}>{role}</p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <PercentInput value={value} onChange={onChange} disabled={disabled} label={`${person} percentage`} />
          <Amount value={amount} />
        </div>
      </div>
    </div>
  );
}

function Amount({ value }: { value: number }) {
  return (
    <span
      style={{
        minWidth: 118,
        textAlign: "right",
        fontSize: 14,
        fontWeight: 700,
        color: T.teal,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {formatMoney(value)}
    </span>
  );
}

/**
 * A percentage box.
 *
 * `type="text"` with a numeric input mode rather than `type="number"`: a number
 * input silently accepts the mouse wheel, which over a field that decides
 * somebody's commission is a way to change a payout by scrolling past it.
 */
function PercentInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 10,
        border: `1px solid ${T.line}`,
        background: T.ground,
      }}
    >
      <input
        type="text"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        aria-label={label ?? "Percentage"}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ""))}
        style={{
          width: 58,
          background: "transparent",
          border: "none",
          outline: "none",
          padding: "9px 4px 9px 10px",
          textAlign: "right",
          fontSize: 14,
          fontWeight: 600,
          color: T.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      />
      <span style={{ paddingRight: 10, fontSize: 13, fontWeight: 600, color: T.faint }} aria-hidden>
        %
      </span>
    </span>
  );
}

function TotalRow({
  label,
  sub,
  value,
  muted,
  strong,
}: {
  label: string;
  sub?: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14 }}>
      <dt style={{ fontSize: 13, color: muted ? T.faint : T.muted }}>
        {label}
        {sub && <span style={{ marginLeft: 6, fontSize: 11.5, color: T.faint }}>{sub}</span>}
      </dt>
      <dd
        style={{
          fontSize: strong ? 16 : 13.5,
          fontWeight: strong ? 800 : 600,
          color: strong ? T.teal : T.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </dd>
    </div>
  );
}

/** Shown on a deal that has already been split, so the record stays readable. */
export function DistributionSummaryCard({
  lines,
  netProfit,
  companyTotalAmount,
  remainingAmount,
  onReopen,
}: {
  lines: Array<{ recipientName: string; percentage: number; amount: number; kind: string }>;
  netProfit: number;
  companyTotalAmount: number;
  remainingAmount: number;
  onReopen?: () => void;
}) {
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${T.line}`, background: T.surface, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <h4 style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>Profit distribution</h4>
        {onReopen && (
          <button
            onClick={onReopen}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: T.amber,
              cursor: "pointer",
            }}
          >
            <RotateCcw size={12} /> Reopen
          </button>
        )}
      </div>

      <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {lines.map((line) => (
          <li
            key={`${line.kind}-${line.recipientName}`}
            style={{ display: "flex", justifyContent: "space-between", gap: 14, fontSize: 12.5 }}
          >
            <span style={{ color: T.muted }}>
              {line.recipientName}
              <span style={{ color: T.faint }}> · {line.percentage}%</span>
            </span>
            <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{formatMoney(line.amount)}</span>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${T.line}`, fontSize: 12.5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
          <span style={{ color: T.faint }}>Remaining to company</span>
          <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{formatMoney(remainingAmount)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginTop: 4 }}>
          <span style={{ color: T.muted }}>Company total</span>
          <span style={{ color: T.teal, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(companyTotalAmount)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginTop: 4 }}>
          <span style={{ color: T.faint }}>Net profit</span>
          <span style={{ color: T.faint, fontVariantNumeric: "tabular-nums" }}>{formatMoney(netProfit)}</span>
        </div>
      </div>
    </div>
  );
}
