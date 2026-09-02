"use client";

/**
 * The complete record of one finalised deal (§7).
 *
 * **Nothing is lost when a deal closes.** The requirement was that the closed
 * record keeps everything — client and KYC, the lead and where it came from,
 * the employee and their manager, the money, the split, and the history — and
 * this is the screen that proves it. It is assembled from the records that
 * already exist rather than from a copy made at close time:
 *
 * | shown | read from |
 * |---|---|
 * | client, amounts, service | the `closedDeals` document (frozen at sale) |
 * | KYC, stage, assignment provenance | the lead the deal points at |
 * | source and folder | denormalised on the deal, lead as the fallback |
 * | profit split | `dealDistributions`, the version currently in force |
 * | history | the lead's own `events` and follow-ups |
 *
 * The deal document holds the *frozen* facts — what the customer's details were
 * at the point of sale, what was received and payable — because those must not
 * change afterwards. Everything else is read live, so a KYC corrected next
 * month shows corrected here too. A snapshot of all of it would have been a
 * second copy to drift.
 */

import { useMemo } from "react";
import {
  X,
  User,
  Phone,
  Mail,
  MapPin,
  IdCard,
  Building2,
  Users,
  UserCheck,
  Database,
  CalendarDays,
  Wallet,
  FileText,
  History,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatBusinessDate, formatBusinessDateTime } from "@/lib/dates";
import { describeLeadSource } from "@/lib/leadSource";
import { KYC_FIELDS } from "@/lib/kyc";
import { entryLabelAt } from "@/lib/followUpKind";
import { LEAD_STATUS_LABELS } from "@/lib/leadStatus";
import { useLeadById, useLeadHistory } from "@/hooks/useLeads";
import { useDealDistribution } from "@/hooks/useDistributions";
import { DistributionSummaryCard } from "./ProfitDistributionModal";
import type { DealRecord } from "@/hooks/useFinancials";

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
};

export function ClosedDealRecord({
  deal,
  employeeName,
  managerName,
  isAdmin,
  onClose,
}: {
  deal: DealRecord;
  employeeName?: string;
  managerName?: string;
  /** Only an admin may read `dealDistributions` — see the rules. */
  isAdmin: boolean;
  onClose: () => void;
}) {
  // The deal id *is* the lead id, so no lookup table is needed.
  const { lead } = useLeadById(deal.leadId ?? deal.id);
  const { followUps, events } = useLeadHistory(deal.leadId ?? deal.id);
  const { distribution } = useDealDistribution(deal.id, isAdmin);

  const kyc = lead?.kyc ?? null;
  const kycRows = useMemo(
    () => KYC_FIELDS.filter((field) => (kyc?.[field.key] ?? "").trim()),
    [kyc]
  );

  const source = describeLeadSource({
    source: deal.source ?? lead?.source ?? null,
    dataBankFolderName: deal.dataBankFolderName ?? lead?.dataBankFolderName ?? null,
    dataBankFolderId: deal.dataBankFolderId ?? lead?.dataBankFolderId ?? null,
    campaignName: deal.campaignName ?? lead?.campaignName ?? null,
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Closed deal record"
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
          maxWidth: 860,
          background: T.ground,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 26px 64px rgba(15,42,40,0.3)",
        }}
      >
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
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.18)",
                  border: "1.5px solid rgba(255,255,255,0.5)",
                  flexShrink: 0,
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                {(deal.customer?.name ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <div style={{ minWidth: 0 }}>
                <h2
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {deal.customer?.name ?? "Client"}
                </h2>
                <p style={{ fontSize: 12.5, opacity: 0.88 }}>
                  {source}
                  {deal.dealDate ? ` · closed ${formatBusinessDate(deal.dealDate)}` : ""}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span
                style={{
                  borderRadius: 999,
                  padding: "4px 11px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.5px",
                  background:
                    deal.distributionStatus === "FINALIZED" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.14)",
                  border: "1px solid rgba(255,255,255,0.4)",
                }}
              >
                {deal.distributionStatus === "FINALIZED" ? "SETTLED" : "AWAITING SPLIT"}
              </span>
              <button onClick={onClose} aria-label="Close" style={{ color: "#fff", cursor: "pointer" }}>
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="cdr-money" style={{ marginTop: 18 }}>
            <HeaderFigure label="Received" value={formatMoney(deal.amountReceived)} />
            <HeaderFigure label="Payable" value={formatMoney(deal.payableAmount)} />
            <HeaderFigure label="Net Profit" value={formatMoney(deal.profit)} strong />
          </div>
        </header>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="cdr-split">
            <Card title="Client" icon={<User size={13} />}>
              <Facts
                rows={[
                  { icon: <Phone size={12} />, label: "Phone", value: deal.customer?.phone ? formatPhone(deal.customer.phone) : null },
                  { icon: <Mail size={12} />, label: "Email", value: deal.customer?.email },
                  { icon: <IdCard size={12} />, label: "CNIC", value: deal.customer?.cnic },
                  { icon: <MapPin size={12} />, label: "City", value: deal.customer?.city },
                  { icon: <MapPin size={12} />, label: "Address", value: deal.customer?.address },
                ]}
              />
            </Card>

            <Card title="Ownership" icon={<Users size={13} />}>
              <Facts
                rows={[
                  { icon: <UserCheck size={12} />, label: "Employee", value: employeeName ?? lead?.assigneeName },
                  { icon: <Users size={12} />, label: "Manager", value: managerName ?? "Admin (directly)" },
                  {
                    icon: <User size={12} />,
                    label: "Assigned by",
                    value: lead?.assignedByName
                      ? `${lead.assignedByName}${lead.assignedByRole ? ` (${lead.assignedByRole})` : ""}`
                      : null,
                  },
                  { icon: <Database size={12} />, label: "Source", value: source },
                  {
                    icon: <CalendarDays size={12} />,
                    label: "Lead created",
                    value: lead?.createdAt ? formatBusinessDate(lead.createdAt) : null,
                  },
                ]}
              />
            </Card>
          </div>

          <Card title="Deal" icon={<Wallet size={13} />}>
            <Facts
              rows={[
                { icon: <FileText size={12} />, label: "Sold", value: deal.serviceDescription },
                { icon: <Wallet size={12} />, label: "Category", value: deal.dealCategory },
                { icon: <Wallet size={12} />, label: "Payment method", value: deal.paymentMethod },
                {
                  icon: <CalendarDays size={12} />,
                  label: "Entered",
                  value: deal.enteredAt ? formatBusinessDateTime(deal.enteredAt) : null,
                },
                { icon: <FileText size={12} />, label: "Notes", value: deal.notes },
              ]}
            />
          </Card>

          {/* The client record as it stands now — corrections after the sale
              show here, which is the point of KYC being the client record. */}
          <Card
            title="Know Your Client"
            icon={<IdCard size={13} />}
            hint={kycRows.length ? `${kycRows.length} fields recorded` : undefined}
          >
            {kycRows.length === 0 ? (
              <Empty>
                No KYC was recorded for this lead. The deal keeps the customer details captured at the
                point of sale, shown above.
              </Empty>
            ) : (
              <div className="cdr-kyc">
                {kycRows.map((field) => (
                  <div key={field.key}>
                    <p style={{ fontSize: 10.5, letterSpacing: "0.6px", textTransform: "uppercase", color: T.faint }}>
                      {field.label}
                    </p>
                    <p style={{ fontSize: 13, color: T.ink, marginTop: 2, wordBreak: "break-word" }}>
                      {kyc?.[field.key]}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {isAdmin && (
            <Card title="Profit distribution" icon={<Building2 size={13} />}>
              {distribution ? (
                <DistributionSummaryCard
                  lines={distribution.lines}
                  netProfit={distribution.netProfit}
                  companyTotalAmount={distribution.companyTotalAmount}
                  remainingAmount={distribution.remainingAmount}
                />
              ) : (
                <Empty>
                  {deal.distributionStatus === "FINALIZED"
                    ? "Marked settled, but the distribution record could not be read."
                    : "Not split yet. Finalize it from Profit Distribution."}
                </Empty>
              )}
            </Card>
          )}

          <Card
            title="History"
            icon={<History size={13} />}
            hint={`${followUps.length} entr${followUps.length === 1 ? "y" : "ies"} · ${events.length} events`}
          >
            {followUps.length === 0 ? (
              <Empty>Nothing was logged against this lead.</Empty>
            ) : (
              <ol style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {followUps.map((entry, index) => (
                  <li key={entry.id} style={{ borderLeft: `2px solid ${T.tealSoft}`, paddingLeft: 12 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          borderRadius: 999,
                          padding: "2px 8px",
                          ...(entryLabelAt(index, followUps.length) === "Remark"
                            ? { background: "#fdf1e3", color: "#a4682a" }
                            : { background: T.tealSoft, color: T.teal }),
                        }}
                      >
                        {entryLabelAt(index, followUps.length)}
                      </span>
                      <span style={{ fontSize: 11.5, color: T.faint }}>
                        {formatBusinessDateTime(entry.occurredAt ?? entry.createdAt)}
                        {entry.authorEmail ? ` · ${entry.authorEmail}` : ""}
                      </span>
                    </div>
                    <p style={{ fontSize: 12.5, color: T.muted, marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {entry.message}
                    </p>
                  </li>
                ))}
              </ol>
            )}

            {lead && (
              <p style={{ marginTop: 12, fontSize: 11.5, color: T.faint }}>
                Final status: {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                {lead.closedAt ? ` · ${formatBusinessDateTime(lead.closedAt)}` : ""}
              </p>
            )}
          </Card>
        </div>

        <style>{`
          .cdr-money { display: grid; grid-template-columns: 1fr; gap: 10px; }
          .cdr-split { display: grid; grid-template-columns: 1fr; gap: 14px; }
          .cdr-kyc { display: grid; grid-template-columns: 1fr; gap: 12px 20px; }
          @media (min-width: 600px) {
            .cdr-money { grid-template-columns: repeat(3, 1fr); }
            .cdr-split { grid-template-columns: 1fr 1fr; }
            .cdr-kyc { grid-template-columns: 1fr 1fr; }
          }
          @media (min-width: 820px) { .cdr-kyc { grid-template-columns: repeat(3, 1fr); } }
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

function Card({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
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
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: "0.6px",
            textTransform: "uppercase",
            color: T.muted,
          }}
        >
          {icon && <span style={{ color: T.teal }}>{icon}</span>}
          {title}
        </h3>
        {hint && <span style={{ fontSize: 11.5, color: T.faint }}>{hint}</span>}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

function Facts({
  rows,
}: {
  rows: Array<{ icon: React.ReactNode; label: string; value?: string | null }>;
}) {
  const present = rows.filter((row) => (row.value ?? "").toString().trim());
  if (present.length === 0) return <Empty>Nothing recorded.</Empty>;

  return (
    <dl style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {present.map((row) => (
        <div key={row.label} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ color: T.teal, marginTop: 2, flexShrink: 0 }} aria-hidden>
            {row.icon}
          </span>
          <div style={{ minWidth: 0 }}>
            <dt style={{ fontSize: 10.5, letterSpacing: "0.6px", textTransform: "uppercase", color: T.faint }}>
              {row.label}
            </dt>
            <dd style={{ fontSize: 13, color: T.ink, wordBreak: "break-word" }}>{row.value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12.5, color: T.faint, lineHeight: 1.5 }}>{children}</p>;
}
