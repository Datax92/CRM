"use client";

/**
 * The complete record of one closed deal (§5, §6, §9).
 *
 * **The half-window bug was not a sizing problem.** Every page sits inside
 * `.animate-page-transition`, which carries `will-change: transform` and so
 * becomes the containing block for `position: fixed` descendants — this panel
 * was pinned to the page's content box instead of the viewport, which is what
 * "stuck in half a window" was. Making it bigger would not have helped;
 * `OverlayPanel` portals it to `document.body`, which does.
 *
 * **Nothing is lost when a deal closes.** The record is assembled from what
 * already exists rather than copied at close time:
 *
 * | shown | read from |
 * |---|---|
 * | client, amounts, service | the `closedDeals` document (frozen at sale) |
 * | KYC, status, assignment provenance | the lead the deal points at |
 * | source and folder | denormalised on the deal, lead as the fallback |
 * | profit split | `dealDistributions`, the version currently in force |
 * | history | the lead's own remark and follow-ups |
 *
 * The deal holds the *frozen* facts — the customer's details at the point of
 * sale, what was received and payable — because those must not move afterwards.
 * The rest is read live, so a KYC corrected next month reads corrected here. A
 * snapshot of all of it would have been a second copy to drift.
 *
 * On a phone the sections become an accordion: the money and the client are
 * open, the rest are a tap away. Eight stacked cards on a 390px screen is a
 * scroll nobody finishes.
 */

import { useMemo, useState } from "react";
import {
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
  ChevronDown,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatBusinessDate, formatBusinessDateTime } from "@/lib/dates";
import { describeLeadSource } from "@/lib/leadSource";
import { KYC_FIELDS } from "@/lib/kyc";
import { entryLabelAt, toChronological } from "@/lib/followUpKind";
import { LEAD_STATUS_LABELS } from "@/lib/leadStatus";
import { useLeadById, useLeadHistory } from "@/hooks/useLeads";
import { useDealDistribution } from "@/hooks/useDistributions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { OverlayPanel, OverlayCard, OverlayFigures } from "@/components/ui/OverlayPanel";
import { DistributionSummaryCard } from "./ProfitDistributionModal";
import type { DealRecord } from "@/hooks/useFinancials";

const T = {
  ink: "#1f3b39",
  muted: "#5b6d6b",
  faint: "#9aacaa",
  line: "#dceae8",
  hair: "#f0f6f5",
  surface: "#ffffff",
  teal: "#2f7d78",
  tealSoft: "#e2f0ee",
  amber: "#a4682a",
  amberSoft: "#fdf1e3",
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
  /** Only an admin may read `dealDistributions` — see the Security Rules. */
  isAdmin: boolean;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();

  // The deal id *is* the lead id, so no lookup table is needed.
  const { lead } = useLeadById(deal.leadId ?? deal.id);
  const { followUps, events } = useLeadHistory(deal.leadId ?? deal.id);
  const { distribution } = useDealDistribution(deal.id, isAdmin);

  const kyc = lead?.kyc ?? null;
  const kycRows = useMemo(() => KYC_FIELDS.filter((field) => (kyc?.[field.key] ?? "").trim()), [kyc]);

  const source = describeLeadSource({
    source: deal.source ?? lead?.source ?? null,
    dataBankFolderName: deal.dataBankFolderName ?? lead?.dataBankFolderName ?? null,
    dataBankFolderId: deal.dataBankFolderId ?? lead?.dataBankFolderId ?? null,
    campaignName: deal.campaignName ?? lead?.campaignName ?? null,
  });

  const settled = deal.distributionStatus === "FINALIZED";

  return (
    <OverlayPanel
      title={deal.customer?.name ?? "Client"}
      subtitle={`${source}${deal.dealDate ? ` · closed ${formatBusinessDate(deal.dealDate)}` : ""}`}
      icon={<span style={{ fontSize: 15, fontWeight: 700 }}>{(deal.customer?.name ?? "?").slice(0, 2).toUpperCase()}</span>}
      maxWidth={860}
      onClose={onClose}
      headerAside={
        <span
          style={{
            borderRadius: 999,
            padding: "4px 11px",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.5px",
            whiteSpace: "nowrap",
            background: settled ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.4)",
          }}
        >
          {settled ? "SETTLED" : "AWAITING SPLIT"}
        </span>
      }
      headerExtra={
        <OverlayFigures
          items={[
            { label: "Received", value: formatMoney(deal.amountReceived) },
            { label: "Payable", value: formatMoney(deal.payableAmount) },
            { label: "Net Profit", value: formatMoney(deal.profit), strong: true },
          ]}
        />
      }
    >
      <Group title="Client" icon={<User size={13} />} mobile={isMobile} defaultOpen>
        <Facts
          rows={[
            {
              icon: <Phone size={12} />,
              label: "Phone",
              value: deal.customer?.phone ? formatPhone(deal.customer.phone) : null,
            },
            { icon: <Mail size={12} />, label: "Email", value: deal.customer?.email },
            { icon: <IdCard size={12} />, label: "CNIC", value: deal.customer?.cnic },
            { icon: <MapPin size={12} />, label: "City", value: deal.customer?.city },
            { icon: <MapPin size={12} />, label: "Address", value: deal.customer?.address },
          ]}
        />
      </Group>

      <Group title="Deal" icon={<Wallet size={13} />} mobile={isMobile} defaultOpen>
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
      </Group>

      <Group title="Ownership & source" icon={<Users size={13} />} mobile={isMobile}>
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
      </Group>

      {/* The client record as it stands now — corrections after the sale show
          here, which is the point of KYC being the client record. */}
      <Group
        title="Know Your Client"
        icon={<IdCard size={13} />}
        hint={kycRows.length ? `${kycRows.length} fields` : undefined}
        mobile={isMobile}
      >
        {kycRows.length === 0 ? (
          <Empty>
            No KYC was recorded for this lead. The deal keeps the customer details captured at the
            point of sale, shown above.
          </Empty>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(170px, 1fr))",
              gap: "12px 20px",
            }}
          >
            {kycRows.map((field) => (
              <div key={field.key} style={{ minWidth: 0 }}>
                <p style={{ fontSize: 10, letterSpacing: "0.6px", textTransform: "uppercase", color: T.faint }}>
                  {field.label}
                </p>
                <p style={{ fontSize: 13, color: T.ink, marginTop: 2, wordBreak: "break-word" }}>
                  {kyc?.[field.key]}
                </p>
              </div>
            ))}
          </div>
        )}
      </Group>

      {isAdmin && (
        <Group title="Profit distribution" icon={<Building2 size={13} />} mobile={isMobile} defaultOpen={settled}>
          {distribution ? (
            <DistributionSummaryCard
              lines={distribution.lines}
              netProfit={distribution.netProfit}
              companyTotalAmount={distribution.companyTotalAmount}
              remainingAmount={distribution.remainingAmount}
            />
          ) : (
            <Empty>
              {settled
                ? "Marked settled, but the distribution record could not be read."
                : "Not split yet. Finalize it from Profit Distribution."}
            </Empty>
          )}
        </Group>
      )}

      <Group
        title="History"
        icon={<History size={13} />}
        hint={`${followUps.length} entr${followUps.length === 1 ? "y" : "ies"} · ${events.length} events`}
        mobile={isMobile}
      >
        {followUps.length === 0 ? (
          <Empty>Nothing was logged against this lead.</Empty>
        ) : (
          <ol style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {toChronological(followUps).map((entry, index) => (
              <li key={entry.id} style={{ borderLeft: `2px solid ${T.tealSoft}`, paddingLeft: 12 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      borderRadius: 999,
                      padding: "2px 8px",
                      ...(entryLabelAt(index, followUps.length, false) === "Remark"
                        ? { background: T.amberSoft, color: T.amber }
                        : { background: T.tealSoft, color: T.teal }),
                    }}
                  >
                    {entryLabelAt(index, followUps.length, false)}
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
      </Group>
    </OverlayPanel>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A card on a desktop, a collapsible row on a phone.
 *
 * Same content either way — the requirement is parity, so nothing is dropped;
 * only the amount visible at once changes.
 */
function Group({
  title,
  icon,
  hint,
  mobile,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  mobile: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!mobile) {
    return (
      <OverlayCard title={title} icon={icon} hint={hint}>
        {children}
      </OverlayCard>
    );
  }

  return (
    <section
      style={{
        background: T.surface,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "13px 16px",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {icon && (
          <span style={{ color: T.teal, flexShrink: 0 }} aria-hidden>
            {icon}
          </span>
        )}
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            color: T.muted,
          }}
        >
          {title}
        </span>
        {hint && <span style={{ fontSize: 11, color: T.faint }}>{hint}</span>}
        <ChevronDown
          size={16}
          style={{
            color: T.faint,
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 160ms ease",
          }}
          aria-hidden
        />
      </button>

      {open && <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.hair}`, paddingTop: 14 }}>{children}</div>}
    </section>
  );
}

function Facts({ rows }: { rows: Array<{ icon: React.ReactNode; label: string; value?: string | null }> }) {
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
            <dt style={{ fontSize: 10, letterSpacing: "0.6px", textTransform: "uppercase", color: T.faint }}>
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
