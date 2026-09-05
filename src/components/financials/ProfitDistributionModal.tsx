"use client";

/**
 * Finalize Profit Distribution — the admin's split screen (§14–§21).
 *
 * **The "stuck form" is fixed by `OverlayPanel`, not by this file's styling.**
 * Every page sits inside `.animate-page-transition`, which carries
 * `will-change: transform` and therefore becomes the containing block for
 * `position: fixed` children — so this panel used to be pinned to the page box
 * rather than the viewport: cropped, unable to scroll properly, trapped.
 * `OverlayPanel` portals to `document.body`, which is the actual cure.
 *
 * Everything else here is the split itself, and the arithmetic is untouched:
 * `lib/profitDistribution` is still the only thing that turns a percentage into
 * rupees, and the Server Action runs the same function, so this screen cannot
 * show a figure the write would disagree with.
 *
 * Three rules drive the layout:
 *
 * 1. **Everything recalculates on the keystroke.** `calculateDistribution` is
 *    called straight from the render body: it is four multiplications, and
 *    memoising it could show a stale rupee figure beside a fresh percentage.
 * 2. **The remainder appears twice on purpose** — once as what is left, once
 *    inside the company total. "The company got 4%" and "the company also kept
 *    the 91% nobody allocated" are different facts (§20).
 * 3. **Over-allocation is refused, not clamped.** The entered figures survive
 *    so the admin can see which one to change, and Finalize stays disabled.
 *
 * On a phone each share becomes a stacked block — name above, percentage and
 * amount below — because a row that keeps a 58px input and a rupee figure on
 * the same line as a name has nowhere to put any of them at 390px.
 */

import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Building2,
  UserCheck,
  Users,
  RotateCcw,
  PieChart,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import {
  readTotalPrice,
  readDownPayment,
  readAdjustment,
  readRemaining,
} from "@/lib/dealAmounts";
import {
  calculateDistribution,
  parsePercentage,
  DEFAULT_COMPANY_PERCENTAGE,
  DEFAULT_EMPLOYEE_PERCENTAGE,
  DEFAULT_SUBADMIN_PERCENTAGE,
  type DistributionShare,
} from "@/lib/profitDistribution";
import { finalizeProfitDistribution } from "@/lib/clientActions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { OverlayPanel, OverlayCard, OverlayFigures } from "@/components/ui/OverlayPanel";
import type { DealRecord } from "@/hooks/useFinancials";
import type { EmployeeData } from "@/hooks/useEmployees";

const T = {
  ink: "#1f3b39",
  muted: "#5b6d6b",
  faint: "#9aacaa",
  line: "#dceae8",
  surface: "#ffffff",
  ground: "#f3faf9",
  teal: "#2f7d78",
  tealSoft: "#e2f0ee",
  amber: "#a4682a",
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
  const isMobile = useIsMobile();

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
  /**
   * The cash the payouts come out of — null for a deal closed before the form
   * asked for it, in which case the row below is simply not shown rather than
   * claiming the client paid nothing.
   */
  const downPaymentOnDeal = readDownPayment(deal);
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
    <OverlayPanel
      title="Finalize Profit Distribution"
      subtitle={`${deal.customer?.name ?? "Client"} · closed by ${employee?.name ?? "an employee"}`}
      icon={<PieChart size={19} />}
      maxWidth={760}
      onClose={onClose}
      headerExtra={
        <OverlayFigures
          items={[
            { label: "Total Price", value: formatMoney(readTotalPrice(deal)) },
            {
              label: "Down Payment",
              // Null, not zero, for a deal closed before the form asked.
              value: readDownPayment(deal) === null ? "—" : formatMoney(readDownPayment(deal)),
            },
            { label: "Adjustment", value: formatMoney(readAdjustment(deal)) },
            { label: "Remaining", value: formatMoney(readRemaining(deal)), strong: true },
          ]}
        />
      }
      footer={
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          {!isMobile && (
            <span style={{ fontSize: 12, color: T.faint, marginRight: "auto" }}>
              Finalising moves this deal into Closed Deals.
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: T.muted,
              cursor: "pointer",
              padding: "11px 16px",
            }}
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
              justifyContent: "center",
              gap: 8,
              // Full width on a phone: the primary action of a sheet should be
              // a thumb-sized target, not a pill in a corner.
              flex: isMobile ? 1 : undefined,
              background: T.teal,
              color: "#fff",
              borderRadius: 999,
              padding: "12px 20px",
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
      }
    >
      <OverlayCard title="Who gets a share" hint="Amounts follow as you type">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ShareRow
            icon={<UserCheck size={15} />}
            person={employee?.name ?? "Unknown employee"}
            role="Employee — closed this deal"
            value={employeePct}
            onChange={setEmployeePct}
            amount={amountFor("EMPLOYEE")}
            disabled={busy}
            stacked={isMobile}
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
              stacked={isMobile}
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

          {/* Optional and the admin's call (§17). It starts as a picker rather
              than a percentage box for a person nobody has named yet. */}
          <div
            style={{
              borderRadius: 12,
              border: `1px solid ${T.line}`,
              background: T.surface,
              padding: "13px 15px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
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

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                justifyContent: "space-between",
              }}
            >
              <select
                value={otherSubUid}
                disabled={busy}
                onChange={(event) => {
                  setOtherSubUid(event.target.value);
                  // A named person on 0% would read as a bug, so choosing one
                  // seeds a figure the admin can then edit.
                  if (event.target.value && parsePercentage(otherSubPct) === 0) setOtherSubPct("1");
                }}
                aria-label="Additional manager"
                style={{
                  flex: "1 1 160px",
                  minWidth: 0,
                  borderRadius: 10,
                  border: `1px solid ${T.line}`,
                  background: T.ground,
                  padding: "10px 11px",
                  fontSize: 13,
                  color: T.ink,
                  cursor: "pointer",
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
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <PercentInput
                    value={otherSubPct}
                    onChange={setOtherSubPct}
                    disabled={busy}
                    label="Additional manager percentage"
                  />
                  <Amount value={amountFor("OTHER_SUBADMIN")} />
                </div>
              )}
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
            stacked={isMobile}
          />
        </div>
      </OverlayCard>

      <OverlayCard title="Distribution summary">
        <dl style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {/* Named for what it is: every percentage below is a percentage of
              this. It is the deal's Remaining — Total Price less any
              adjustment — which is the rule the owner set. */}
          <TotalRow
            label="Commission base"
            sub={readAdjustment(deal) > 0 ? "Total price less the adjustment" : "The total price"}
            value={formatMoney(result.netProfit)}
          />
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

          {/*
            **Where the money is actually coming from.**

            The shares are a percentage of the price, but they are paid out of
            what the client has actually handed over — the down payment. Those
            are different numbers and nothing else on this screen says so, which
            is how an admin finalises a split the business cannot yet fund.
            Shown, never enforced: a shortfall is often covered elsewhere, and
            refusing the split would be this screen inventing a rule about the
            company's cash flow.
          */}
          {downPaymentOnDeal !== null && (
            <>
              <div style={{ height: 1, background: T.line, margin: "3px 0" }} aria-hidden />
              <TotalRow
                label="Paid from the down payment"
                sub={
                  result.distributedAmount > downPaymentOnDeal
                    ? `${formatMoney(result.distributedAmount - downPaymentOnDeal)} more than has been received`
                    : `${formatMoney(downPaymentOnDeal - result.distributedAmount)} of it left`
                }
                value={formatMoney(downPaymentOnDeal)}
                muted={result.distributedAmount <= downPaymentOnDeal}
              />
            </>
          )}

          {/* A bar, so "how much is still unallocated" is answerable at a
              glance and not only by reading four numbers. */}
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

        {isMobile && (
          <p style={{ marginTop: 12, fontSize: 11.5, color: T.faint }}>
            Finalising moves this deal into Closed Deals.
          </p>
        )}
      </OverlayCard>
    </OverlayPanel>
  );
}

/* -------------------------------------------------------------------------- */

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
  stacked,
}: {
  icon: React.ReactNode;
  person: string;
  role: string;
  value: string;
  onChange: (next: string) => void;
  amount: number;
  disabled: boolean;
  /** Phone: identity on one line, the money controls on the next. */
  stacked: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${T.line}`,
        background: T.surface,
        padding: "13px 15px",
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: stacked ? "space-between" : "flex-end",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <PercentInput value={value} onChange={onChange} disabled={disabled} label={`${person} percentage`} />
        <Amount value={amount} />
      </div>
    </div>
  );
}

function Amount({ value }: { value: number }) {
  return (
    <span
      style={{
        minWidth: 110,
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
 * somebody's commission is a way to change a payout by scrolling past it. The
 * numeric keypad still comes up on a phone.
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
        flexShrink: 0,
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
          width: 62,
          background: "transparent",
          border: "none",
          outline: "none",
          // 16px on the input itself: anything smaller makes iOS Safari zoom
          // the page when the field is focused, which on a sheet leaves the
          // user scrolled somewhere they did not ask to be.
          padding: "10px 4px 10px 10px",
          textAlign: "right",
          fontSize: 16,
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
            <span style={{ color: T.muted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {line.recipientName}
              <span style={{ color: T.faint }}> · {line.percentage}%</span>
            </span>
            <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
              {formatMoney(line.amount)}
            </span>
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
