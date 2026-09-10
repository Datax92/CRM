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
  UserCheck,
  Users,
  RotateCcw,
  PieChart,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import {
  dealFigureRows,
  readDownPayment,
  readCutBase,
  readDealType,
  readPayoutSource,
  CUT_BASE_LABELS,
  CUT_SOURCE_LABELS,
  DEAL_TYPE_LABELS,
} from "@/lib/dealAmounts";
import {
  calculateDistribution,
  parsePercentage,
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
  ];

  /**
   * **The two figures the split turns on, and they are different questions.**
   *
   * `cutBase` is what every percentage below multiplies; `payoutSource` is the
   * pot the finalised cuts come out of and what the company keeps the rest of.
   * On a 50 lakh sale with a 10 lakh adjustment they are 50 lakh and 40 lakh —
   * a 1% cut is 50,000, taken out of the 40 lakh. Both are named on screen
   * because an admin cannot check a figure whose base is not shown.
   *
   * Read through `lib/dealAmounts`, so a deal recorded before these fields
   * existed gets the same answer by the same table.
   */
  const dealType = readDealType(deal);
  const cutBase = readCutBase(deal);
  const payoutSource = readPayoutSource(deal);
  const result = calculateDistribution({ cutBase, payoutSource }, shares);

  /**
   * The cash actually in hand — null for a deal closed before the form asked,
   * in which case the row is not shown rather than claiming the client paid
   * nothing. Not shown at all for a lump sum, where the client's money went to
   * the builder and the commission is already the pot.
   */
  const downPaymentOnDeal = dealType === "LUMP_SUM" ? null : readDownPayment(deal);
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
      subtitle={`${deal.customer?.name ?? "Client"} · ${DEAL_TYPE_LABELS[dealType]} · closed by ${employee?.name ?? "an employee"}`}
      icon={<PieChart size={19} />}
      maxWidth={760}
      onClose={onClose}
      headerExtra={
        /* The deal in its **own** type's fields — a lump sum shown as a total
           price and a remaining would be four figures it does not have. */
        <OverlayFigures
          items={dealFigureRows(deal).map((row) => ({
            label: row.label,
            // Null, not zero, for a figure an older form never asked for.
            value: row.value === null ? "—" : formatMoney(row.value),
            strong: row.strong,
          }))}
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

          {/*
            **There is no company percentage.** The company is not one of the
            recipients — it keeps whatever is left of the payment source after
            the finalised cuts, which is the line at the foot of the summary.
            A company share of the *base* would be charged against money the
            base does not represent: on a lump sum, 4% of the client's 40 lakh
            is 1.6 lakh taken out of a 4 lakh commission.
          */}
        </div>
      </OverlayCard>

      <OverlayCard title="Distribution summary">
        <dl style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {/* **The base, then the pot, in that order** — they are the two
              numbers an admin has to be able to check, and on three of the four
              deal types they are not the same. Naming the field each one comes
              from is what makes the arithmetic verifiable rather than trusted. */}
          <TotalRow
            label={`Cut base — ${CUT_BASE_LABELS[dealType].toLowerCase()}`}
            sub="every percentage above is a percentage of this"
            value={formatMoney(result.cutBase)}
          />
          <TotalRow
            label="Total cuts"
            sub={`${result.distributedPercentage}% of the base`}
            value={formatMoney(result.distributedAmount)}
          />
          <div style={{ height: 1, background: T.line, margin: "3px 0" }} aria-hidden />
          <TotalRow
            label={`Paid from — ${CUT_SOURCE_LABELS[dealType].toLowerCase()}`}
            sub={
              result.distributedAmount > result.payoutSource
                ? `${formatMoney(result.distributedAmount - result.payoutSource)} more than this deal holds`
                : `${result.sourceUsedPercentage}% of it goes out in cuts`
            }
            value={formatMoney(result.payoutSource)}
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
/**
 * A finalised split, as stored.
 *
 * **Reads the record, never recomputes it.** A split is frozen at the moment
 * it was finalised, so a rule that changes afterwards must not restate what
 * people were paid. Splits finalised before 2026-09-09 carry `netProfit` and
 * `companyTotalAmount` and no Cut base — under the single-pot rule the base
 * and the source were the same number — so those fields are the fallback and
 * the base line is simply absent rather than invented.
 */
export function DistributionSummaryCard({
  lines,
  netProfit,
  companyTotalAmount,
  cutBase,
  payoutSource,
  companyRetained,
  onReopen,
}: {
  lines: Array<{ recipientName: string; percentage: number; amount: number; kind: string }>;
  netProfit: number;
  companyTotalAmount: number;
  cutBase?: number | null;
  payoutSource?: number | null;
  companyRetained?: number | null;
  onReopen?: () => void;
}) {
  const source = payoutSource ?? netProfit;
  const kept = companyRetained ?? companyTotalAmount;
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
        {/* Absent on a split finalised under the old single-pot rule, where
            there was no separate base to name. */}
        {cutBase != null && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
            <span style={{ color: T.faint }}>Cut base</span>
            <span style={{ color: T.faint, fontVariantNumeric: "tabular-nums" }}>{formatMoney(cutBase)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginTop: 4 }}>
          <span style={{ color: T.faint }}>Paid from</span>
          <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{formatMoney(source)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginTop: 4 }}>
          <span style={{ color: T.muted }}>Company keeps</span>
          <span style={{ color: T.teal, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(kept)}
          </span>
        </div>
      </div>
    </div>
  );
}
