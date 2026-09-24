"use client";

/**
 * Edit a closed deal — the admin's correction (owner, 2026-09-24).
 *
 * One panel for every place a closed deal is shown to the admin — Profit
 * Distribution, Closed Deals, and the deal record inside a lead — on both
 * widths. `OverlayPanel` portals and sizes it; this file only lays out fields.
 *
 * The arithmetic is `lib/dealAmounts`, the same module Deal Entry and the
 * Server Action run, so the preview here is exactly what will be stored. The
 * server recomputes it anyway and never trusts a figure from this form.
 *
 * Saving over a split that is already finalised sends the deal back to
 * Profit Distribution when the money changes; the panel says so before Save.
 */

import { useState } from "react";
import { PencilLine, AlertTriangle } from "lucide-react";
import { formatMoney } from "@/lib/money";
import {
  dealAmounts,
  validateDealAmounts,
  isPricedType,
  readDealType,
  readTotalPrice,
  readDownPayment,
  readAdjustment,
  readDiscount,
  readDownPaymentKind,
  readReceivedAmount,
  readCommission,
  payoutSourceLabel,
  CUT_BASE_LABELS,
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  DOWN_PAYMENT_KINDS,
  DOWN_PAYMENT_KIND_LABELS,
  type DealType,
  type DownPaymentKind,
} from "@/lib/dealAmounts";
import { DEAL_CATEGORIES, normalizeDealCategory } from "@/lib/constants/deals";
import { PAYMENT_METHODS, updateClosedDeal } from "@/lib/clientActions";
import { karachiDayKey, timestampMillis } from "@/lib/dates";
import { useIsMobile } from "@/hooks/useIsMobile";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import type { DealRecord } from "@/hooks/useFinancials";

const T = {
  ink: "#1f3b39",
  muted: "#5b6d6b",
  faint: "#9aacaa",
  line: "#dceae8",
  ground: "#f3faf9",
  teal: "#2f7d78",
  tealSoft: "#e2f0ee",
  amber: "#a4682a",
  red: "#a33a29",
  redSoft: "#fdeeeb",
  redLine: "#f0c4bd",
};

/** The stored figure as an input value: blank for nothing, never "0" noise. */
const field = (value: number | null | undefined) => (value ? String(value) : "");

export interface EditDealModalProps {
  deal: DealRecord;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function EditDealModal({ deal, getIdToken, onClose, onDone }: EditDealModalProps) {
  const isMobile = useIsMobile();
  const storedType = readDealType(deal);
  const storedPaid = readDownPayment(deal);
  const dateMillis = timestampMillis(deal.dealDate ?? deal.enteredAt);

  const [name, setName] = useState(deal.customer?.name ?? "");
  const [phone, setPhone] = useState(deal.customer?.phone ?? "");
  const [email, setEmail] = useState(deal.customer?.email ?? "");
  const [cnic, setCnic] = useState(deal.customer?.cnic ?? "");
  const [serviceDescription, setServiceDescription] = useState(deal.serviceDescription ?? "");
  const [dealType, setDealType] = useState<DealType>(storedType);
  const [totalPrice, setTotalPrice] = useState(field(isPricedType(storedType) ? readTotalPrice(deal) : 0));
  const [discount, setDiscount] = useState(field(readDiscount(deal)));
  const [downPaymentKind, setDownPaymentKind] = useState<DownPaymentKind>(readDownPaymentKind(deal));
  const [downPayment, setDownPayment] = useState(field(storedType === "DOWN_PAYMENT" ? storedPaid : 0));
  const [confirmationAmount, setConfirmationAmount] = useState(
    field(storedType === "CONFIRMATION" ? storedPaid : 0)
  );
  const [adjustment, setAdjustment] = useState(field(isPricedType(storedType) ? readAdjustment(deal) : 0));
  const [receivedAmount, setReceivedAmount] = useState(
    field(isPricedType(storedType) ? 0 : readReceivedAmount(deal))
  );
  const [payableAmount, setPayableAmount] = useState(
    field(storedType === "INSTALLMENTS" ? readAdjustment(deal) : storedType === "LUMP_SUM" ? deal.payableAmount : 0)
  );
  const [commission, setCommission] = useState(field(readCommission(deal)));
  const [paymentMethod, setPaymentMethod] = useState(deal.paymentMethod || "Cash");
  const [dealCategory, setDealCategory] = useState<string>(normalizeDealCategory(deal.dealCategory));
  const [dealDate, setDealDate] = useState(dateMillis !== null ? karachiDayKey(new Date(dateMillis)) : "");
  const [notes, setNotes] = useState(deal.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priced = isPricedType(dealType);
  const typed = {
    dealType,
    totalPrice: Number(totalPrice),
    discount: Number(discount),
    downPaymentKind,
    downPayment: Number(downPayment),
    confirmationAmount: Number(confirmationAmount),
    adjustment: Number(adjustment),
    receivedAmount: Number(receivedAmount),
    payableAmount: Number(payableAmount),
    commission: Number(commission),
  };
  const amounts = dealAmounts(typed);
  const amountErrors = validateDealAmounts(typed);
  const finalised = deal.distributionStatus === "FINALIZED";

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await updateClosedDeal(await getIdToken(), deal.id, {
        customer: {
          name,
          phone,
          email,
          cnic,
          address: deal.customer?.address ?? "",
          city: deal.customer?.city ?? "",
        },
        serviceDescription,
        ...typed,
        paymentMethod,
        dealCategory,
        dealDate: dealDate || undefined,
        notes,
      });
      if (result.ok) {
        onDone(
          result.data.reopened
            ? "Deal updated. Its profit split was reopened — finalise it again in Profit Distribution."
            : "Deal updated."
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

  const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
    gap: 12,
  };

  return (
    <OverlayPanel
      title="Edit Deal"
      subtitle={`${deal.customer?.name ?? "Client"} · ${DEAL_TYPE_LABELS[dealType]}`}
      icon={<PencilLine size={19} />}
      maxWidth={760}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
          {!isMobile && (
            <span style={{ fontSize: 12, color: T.faint, marginRight: "auto" }}>
              The previous figures are kept on the deal&rsquo;s history.
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{ fontSize: 13.5, fontWeight: 500, color: T.muted, cursor: "pointer", padding: "11px 16px" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || amountErrors.length > 0}
            style={{
              flex: isMobile ? 1 : undefined,
              background: T.teal,
              color: "#fff",
              borderRadius: 999,
              padding: "12px 20px",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: busy || amountErrors.length > 0 ? "not-allowed" : "pointer",
              opacity: busy || amountErrors.length > 0 ? 0.5 : 1,
            }}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      }
    >
      <OverlayCard title="Customer">
        <div style={grid}>
          <Field label="Full name *" value={name} onChange={setName} mobile={isMobile} />
          <Field label="Phone *" value={phone} onChange={setPhone} mobile={isMobile} type="tel" />
          <Field label="Email" value={email} onChange={setEmail} mobile={isMobile} type="email" />
          <Field label="CNIC / ID" value={cnic} onChange={setCnic} mobile={isMobile} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Field
            label="Package / service *"
            value={serviceDescription}
            onChange={setServiceDescription}
            mobile={isMobile}
          />
        </div>
      </OverlayCard>

      <OverlayCard title="Figures" hint="Recalculated as you type">
        <Segmented
          label="Deal type"
          options={DEAL_TYPES.map((type) => ({ value: type, label: DEAL_TYPE_LABELS[type] }))}
          value={dealType}
          onChange={(value) => setDealType(value as DealType)}
          columns={isMobile ? 2 : 4}
        />

        <div style={{ ...grid, marginTop: 12 }}>
          {priced ? (
            <>
              <Field label="Total price (PKR) *" value={totalPrice} onChange={setTotalPrice} mobile={isMobile} money />
              <Field label="Discount (PKR)" value={discount} onChange={setDiscount} mobile={isMobile} money />
              {dealType === "DOWN_PAYMENT" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Segmented
                    label="Down payment kind"
                    options={DOWN_PAYMENT_KINDS.map((kind) => ({ value: kind, label: DOWN_PAYMENT_KIND_LABELS[kind] }))}
                    value={downPaymentKind}
                    onChange={(value) => setDownPaymentKind(value as DownPaymentKind)}
                    columns={2}
                    small
                  />
                  <Field
                    label={`${DOWN_PAYMENT_KIND_LABELS[downPaymentKind]} (PKR)`}
                    value={downPayment}
                    onChange={setDownPayment}
                    mobile={isMobile}
                    money
                  />
                </div>
              ) : (
                <Field
                  label="Confirmation (PKR)"
                  value={confirmationAmount}
                  onChange={setConfirmationAmount}
                  mobile={isMobile}
                  money
                />
              )}
              <Field label="Adjustment (PKR)" value={adjustment} onChange={setAdjustment} mobile={isMobile} money />
            </>
          ) : (
            <>
              <Field
                label={dealType === "LUMP_SUM" ? "Amount received — to the builder *" : "Amount received (PKR) *"}
                value={receivedAmount}
                onChange={setReceivedAmount}
                mobile={isMobile}
                money
              />
              <Field label="Payable amount (PKR)" value={payableAmount} onChange={setPayableAmount} mobile={isMobile} money />
              {dealType === "LUMP_SUM" && (
                <Field label="Commission (PKR) *" value={commission} onChange={setCommission} mobile={isMobile} money />
              )}
            </>
          )}
        </div>

        {/* The two figures the split will use, as they will be stored. */}
        <div
          aria-live="polite"
          style={{
            marginTop: 14,
            borderRadius: 12,
            border: "1px solid #bfe0dc",
            background: "#eef8f7",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 13,
          }}
        >
          {amounts.remaining !== null && (
            <Line label="Remaining" value={formatMoney(amounts.remaining)} />
          )}
          <Line label={`Cut base — ${CUT_BASE_LABELS[dealType]}`} value={formatMoney(amounts.cutBase)} strong />
          <Line
            label={`Paid from — ${payoutSourceLabel(dealType, downPaymentKind)}`}
            value={formatMoney(amounts.payoutSource)}
            strong
          />
        </div>
      </OverlayCard>

      <OverlayCard title="Settlement">
        <div style={grid}>
          <Select
            label="Payment method"
            value={paymentMethod}
            onChange={setPaymentMethod}
            options={PAYMENT_METHODS as readonly string[]}
            mobile={isMobile}
          />
          <Select
            label="Portfolio category"
            value={dealCategory}
            onChange={setDealCategory}
            options={DEAL_CATEGORIES}
            mobile={isMobile}
          />
          <Field
            label="Settlement date"
            value={dealDate}
            onChange={setDealDate}
            mobile={isMobile}
            type="date"
            max={karachiDayKey()}
          />
          <Field label="Notes" value={notes} onChange={setNotes} mobile={isMobile} />
        </div>

        {finalised && (
          <p style={{ marginTop: 14, display: "flex", gap: 8, fontSize: 12.5, color: T.amber }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            This deal&rsquo;s profit is already split. Changing its figures sends it back to Profit
            Distribution to be split again; the current split stays on record.
          </p>
        )}

        {(amountErrors[0] || error) && (
          <p
            role="alert"
            style={{
              marginTop: 12,
              borderRadius: 10,
              border: `1px solid ${T.redLine}`,
              background: T.redSoft,
              color: T.red,
              padding: "10px 12px",
              fontSize: 12.5,
            }}
          >
            {amountErrors[0] ?? error}
          </p>
        )}
      </OverlayCard>
    </OverlayPanel>
  );
}

/* -------------------------------------------------------------------------- */

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  fontSize: 12,
  fontWeight: 600,
  color: T.muted,
  minWidth: 0,
};

const inputStyle = (mobile: boolean): React.CSSProperties => ({
  width: "100%",
  borderRadius: 10,
  border: `1px solid ${T.line}`,
  background: T.ground,
  padding: "10px 11px",
  // 16px on a phone, or iOS Safari zooms the page on focus.
  fontSize: mobile ? 16 : 13.5,
  fontWeight: 500,
  color: T.ink,
  outline: "none",
});

function Field({
  label,
  value,
  onChange,
  mobile,
  type = "text",
  money,
  max,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  mobile: boolean;
  type?: string;
  money?: boolean;
  max?: string;
}) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      <input
        type={money ? "text" : type}
        inputMode={money ? "decimal" : undefined}
        value={value}
        max={max}
        placeholder={money ? "0" : undefined}
        // Money is typed as text: a number input changes on the mouse wheel,
        // which over a price is a way to edit a deal by scrolling past it.
        onChange={(event) => onChange(money ? event.target.value.replace(/[^\d.]/g, "") : event.target.value)}
        style={{ ...inputStyle(mobile), fontVariantNumeric: money ? "tabular-nums" : undefined }}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  mobile,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  mobile: boolean;
}) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...inputStyle(mobile), cursor: "pointer" }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
  columns,
  small,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (next: string) => void;
  columns: number;
  small?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 6 }}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            style={{
              borderRadius: 10,
              border: `1px solid ${on ? "#3f8f8a" : T.line}`,
              background: on ? T.tealSoft : "#fff",
              color: on ? T.teal : T.muted,
              padding: small ? "6px 8px" : "9px 10px",
              fontSize: small ? 12 : 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: strong ? T.teal : T.muted }}>{label}</span>
      <span style={{ color: T.teal, fontWeight: strong ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}
