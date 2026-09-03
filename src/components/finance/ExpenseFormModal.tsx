"use client";

/**
 * Recording or editing an office expense.
 *
 * The receipt is captured as a **link** rather than an upload. The app has no
 * file storage wired up for financial documents, and inventing one here would
 * be a half-built feature on the screen that most needs to be trustworthy — a
 * link to Drive, a shared folder or a scanned-invoice service is honest about
 * where the document actually lives, and it survives this app.
 *
 * Editing keeps the status untouched: approving is its own action with its own
 * audit line, and letting an edit quietly flip a rejected invoice to approved
 * would be the one hole in that record.
 */

import { useState } from "react";
import { Receipt } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { createOfficeExpense, updateOfficeExpense } from "@/lib/clientActions";
import {
  EXPENSE_STATUS_LABELS,
  PAYMENT_METHODS,
  type ExpenseStatus,
  type OfficeExpense,
} from "@/lib/officeExpenses";
import { karachiDayKey } from "@/lib/dates";
import { Banner, F, Field, PrimaryButton, fieldStyle, rupees } from "./financeChrome";

export function ExpenseFormModal({
  expense,
  categories,
  onClose,
  onSaved,
}: {
  /** Null when recording a new one. */
  expense: OfficeExpense | null;
  categories: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { getIdToken } = useAuth();
  const editing = Boolean(expense);

  const [title, setTitle] = useState(expense?.title ?? "");
  const [category, setCategory] = useState(expense?.category ?? categories[0] ?? "Other");
  const [amount, setAmount] = useState(expense?.amount ?? 0);
  const [date, setDate] = useState(expense?.dayKey ?? karachiDayKey());
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? "");
  const [paymentMethod, setPaymentMethod] = useState(expense?.paymentMethod ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [receiptUrl, setReceiptUrl] = useState(expense?.receiptUrl ?? "");
  const [receiptName, setReceiptName] = useState(expense?.receiptName ?? "");
  const [status, setStatus] = useState<ExpenseStatus>("PENDING");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);

    if (!title.trim()) {
      setError("Give the expense a title.");
      return;
    }
    if (!(amount > 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (date > karachiDayKey()) {
      setError("The expense date cannot be in the future.");
      return;
    }

    setBusy(true);
    const token = await getIdToken();
    const payload = {
      title,
      category,
      amount,
      date,
      paidBy,
      paymentMethod,
      description,
      receiptUrl,
      receiptName: receiptName || (receiptUrl ? "Receipt" : ""),
    };

    const result = expense
      ? await updateOfficeExpense(token, expense.id, payload)
      : await createOfficeExpense(token, { ...payload, status });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(
      editing
        ? `"${title.trim()}" updated.`
        : `"${title.trim()}" recorded — ${rupees(amount)}, ${EXPENSE_STATUS_LABELS[status].toLowerCase()}.`
    );
  };

  return (
    <OverlayPanel
      title={editing ? "Edit expense" : "Add office expense"}
      subtitle={editing ? expense?.title : "Recorded against the office ledger"}
      icon={<Receipt size={18} color="#fff" />}
      maxWidth={620}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: F.ink }}>{rupees(amount)}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <PrimaryButton onClick={onClose} tone="quiet">
              Cancel
            </PrimaryButton>
            <PrimaryButton onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Record expense"}
            </PrimaryButton>
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <OverlayCard title="What was spent">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
            }}
          >
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Title">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={busy}
                  placeholder="September office rent"
                  style={fieldStyle}
                />
              </Field>
            </div>

            <Field label="Category">
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                disabled={busy}
                style={fieldStyle}
              >
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Amount (PKR)">
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))}
                disabled={busy}
                style={{ ...fieldStyle, fontVariantNumeric: "tabular-nums" }}
              />
            </Field>

            <Field label="Date">
              <input
                type="date"
                value={date}
                max={karachiDayKey()}
                onChange={(event) => setDate(event.target.value)}
                disabled={busy}
                style={fieldStyle}
              />
            </Field>
          </div>
        </OverlayCard>

        <OverlayCard title="How it was paid">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
            }}
          >
            <Field label="Paid by">
              <input
                value={paidBy}
                onChange={(event) => setPaidBy(event.target.value)}
                disabled={busy}
                placeholder="Who actually paid"
                style={fieldStyle}
              />
            </Field>

            <Field label="Payment method">
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                disabled={busy}
                style={fieldStyle}
              >
                <option value="">Not recorded</option>
                {PAYMENT_METHODS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>

            {!editing && (
              <Field label="Status" hint="Approve now only if you are the one approving it.">
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as ExpenseStatus)}
                  disabled={busy}
                  style={fieldStyle}
                >
                  <option value="PENDING">Pending approval</option>
                  <option value="APPROVED">Already approved</option>
                </select>
              </Field>
            )}
          </div>
        </OverlayCard>

        <OverlayCard title="Receipt and notes" hint="A link to where the document lives">
          <div style={{ display: "grid", gap: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
              }}
            >
              <Field label="Receipt link">
                <input
                  value={receiptUrl}
                  onChange={(event) => setReceiptUrl(event.target.value)}
                  disabled={busy}
                  placeholder="https://…"
                  style={fieldStyle}
                />
              </Field>
              <Field label="Receipt name">
                <input
                  value={receiptName}
                  onChange={(event) => setReceiptName(event.target.value)}
                  disabled={busy}
                  placeholder="Invoice 4471"
                  style={fieldStyle}
                />
              </Field>
            </div>

            <Field label="Description / notes">
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                disabled={busy}
                placeholder="Anything worth recording about this expense."
                style={{ ...fieldStyle, resize: "vertical" }}
              />
            </Field>
          </div>
        </OverlayCard>

        {error && <Banner ok={false}>{error}</Banner>}
      </div>
    </OverlayPanel>
  );
}
