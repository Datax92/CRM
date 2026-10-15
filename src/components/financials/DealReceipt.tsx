"use client";

/**
 * A printable receipt for a closed deal — opened by "Print receipt" on the
 * ClosedDealRecord overlay.
 *
 * Renders the receipt into a hidden iframe and calls `window.print()` on it,
 * so the main page is never disrupted by print styles. The receipt includes
 * the company header, client details, deal figures, and a signature line.
 */

import { useCallback, useRef } from "react";
import { formatMoney } from "@/lib/money";
import { dealFigureRows, readDealType, DEAL_TYPE_LABELS } from "@/lib/dealAmounts";
import { formatPhone } from "@/lib/phone";
import { formatBusinessDate } from "@/lib/dates";
import type { DealRecord } from "@/hooks/useFinancials";

const COMPANY = {
  name: "MAHZIYAR REAL ESTATE MARKETING",
  address:
    "First Floor, Benazir Plaza, Office # 113 Jinnah Ave, Block H G 7/2 Blue Area, Islamabad, 44000",
  phone: "0312 5772180",
};

// The frame is same-origin, so an unescaped customer name would run as script in the CRM.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function optional(value: string | null | undefined): string | null {
  return value ? esc(value) : null;
}

function buildReceiptHtml(deal: DealRecord, employeeName?: string): string {
  const customer = deal.customer;
  const figures = dealFigureRows(deal);
  const dealType = esc(DEAL_TYPE_LABELS[readDealType(deal)] ?? "Deal");
  const dealDate = esc(formatBusinessDate(deal.dealDate ?? deal.enteredAt) || "—");
  const clientName = esc(customer?.name || "—");
  const clientPhone = esc(customer?.phone ? formatPhone(customer.phone) : "—");
  const clientCnic = optional(customer?.cnic);
  const clientCity = optional(customer?.city);
  const clientAddress = optional(customer?.address);
  const service = esc(deal.serviceDescription || "—");
  const paymentMethod = esc(deal.paymentMethod || "—");
  const category = optional(deal.dealCategory);
  const notes = optional(deal.notes);
  employeeName = optional(employeeName) ?? undefined;
  const receiptNo = esc(`MRE-${(deal.id ?? "").slice(-6).toUpperCase()}`);

  const figureRows = figures
    .map(
      (row) =>
        `<tr${row.strong ? ' class="strong"' : ""}>
          <td>${esc(row.label)}</td>
          <td class="amount">${row.value === null ? "—" : formatMoney(row.value)}</td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Receipt — ${clientName}</title>
<style>
  @page { size: A4; margin: 18mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    color: #1f3b39;
    font-size: 13px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .receipt {
    max-width: 680px;
    margin: 0 auto;
    padding: 0;
  }

  /* ---------- Header ---------- */
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding-bottom: 16px;
    border-bottom: 2.5px solid #2f7d78;
    margin-bottom: 20px;
  }
  .header img {
    width: 80px;
    height: auto;
  }
  .header-text {
    flex: 1;
  }
  .header-text h1 {
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.8px;
    color: #2f7d78;
    margin-bottom: 2px;
  }
  .header-text p {
    font-size: 10.5px;
    color: #5b6d6b;
    line-height: 1.4;
  }

  /* ---------- Receipt meta ---------- */
  .meta {
    display: flex;
    justify-content: space-between;
    margin-bottom: 20px;
    font-size: 12px;
  }
  .meta-label { color: #5b6d6b; }
  .meta-value { font-weight: 600; color: #1f3b39; }

  /* ---------- Section ---------- */
  .section {
    margin-bottom: 18px;
  }
  .section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #2f7d78;
    border-bottom: 1px solid #dceae8;
    padding-bottom: 4px;
    margin-bottom: 10px;
  }

  /* ---------- Info grid ---------- */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 24px;
    font-size: 12.5px;
  }
  .info-grid dt {
    color: #5b6d6b;
    font-size: 10.5px;
    margin-top: 4px;
  }
  .info-grid dd {
    font-weight: 500;
    margin-bottom: 4px;
  }

  /* ---------- Figures table ---------- */
  .figures-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .figures-table th {
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: #5b6d6b;
    border-bottom: 1.5px solid #dceae8;
    padding: 6px 0;
  }
  .figures-table th.amount { text-align: right; }
  .figures-table td {
    padding: 7px 0;
    border-bottom: 1px solid #f0f6f5;
  }
  .figures-table td.amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .figures-table tr.strong td {
    font-weight: 700;
    font-size: 14px;
    border-top: 1.5px solid #2f7d78;
    border-bottom: 1.5px solid #2f7d78;
    color: #2f7d78;
  }

  /* ---------- Signature ---------- */
  .signatures {
    display: flex;
    justify-content: space-between;
    margin-top: 48px;
    padding-top: 12px;
  }
  .sig-block {
    text-align: center;
    min-width: 160px;
  }
  .sig-line {
    border-top: 1px solid #1f3b39;
    padding-top: 6px;
    font-size: 11px;
    color: #5b6d6b;
  }

  /* ---------- Footer ---------- */
  .footer {
    margin-top: 36px;
    text-align: center;
    font-size: 10px;
    color: #9aacaa;
    border-top: 1px solid #dceae8;
    padding-top: 10px;
  }
</style>
</head>
<body>
<div class="receipt">
  <div class="header">
    <img src="/mahziyar-logo.png" alt="Mahziyar" />
    <div class="header-text">
      <h1>${COMPANY.name}</h1>
      <p>${COMPANY.address}<br />Phone: ${COMPANY.phone}</p>
    </div>
  </div>

  <div class="meta">
    <div>
      <span class="meta-label">Receipt No.</span><br />
      <span class="meta-value">${receiptNo}</span>
    </div>
    <div>
      <span class="meta-label">Deal Type</span><br />
      <span class="meta-value">${dealType}</span>
    </div>
    <div style="text-align: right;">
      <span class="meta-label">Date</span><br />
      <span class="meta-value">${dealDate}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Client Information</div>
    <dl class="info-grid">
      <dt>Name</dt><dd>${clientName}</dd>
      <dt>Phone</dt><dd>${clientPhone}</dd>
      ${clientCnic ? `<dt>CNIC</dt><dd>${clientCnic}</dd>` : ""}
      ${clientCity ? `<dt>City</dt><dd>${clientCity}</dd>` : ""}
      ${clientAddress ? `<dt>Address</dt><dd>${clientAddress}</dd>` : ""}
    </dl>
  </div>

  <div class="section">
    <div class="section-title">Deal Details</div>
    <dl class="info-grid">
      <dt>Property / Service</dt><dd>${service}</dd>
      <dt>Payment Method</dt><dd>${paymentMethod}</dd>
      ${category ? `<dt>Category</dt><dd>${category}</dd>` : ""}
      ${notes ? `<dt>Notes</dt><dd>${notes}</dd>` : ""}
      ${employeeName ? `<dt>Handled by</dt><dd>${employeeName}</dd>` : ""}
    </dl>
  </div>

  <div class="section">
    <div class="section-title">Financial Summary</div>
    <table class="figures-table">
      <thead>
        <tr><th>Description</th><th class="amount">Amount (PKR)</th></tr>
      </thead>
      <tbody>${figureRows}</tbody>
    </table>
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line">Client Signature</div>
    </div>
    <div class="sig-block">
      <div class="sig-line">Authorized Signature</div>
    </div>
  </div>

  <div class="footer">
    ${COMPANY.name} &middot; ${COMPANY.phone} &middot; ${COMPANY.address}
  </div>
</div>
</body>
</html>`;
}

export function usePrintReceipt() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const print = useCallback((deal: DealRecord, employeeName?: string) => {
    const html = buildReceiptHtml(deal, employeeName);

    let frame = frameRef.current;
    if (!frame) {
      frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:none;";
      document.body.appendChild(frame);
      frameRef.current = frame;
    }

    const doc = frame.contentDocument ?? frame.contentWindow?.document;
    if (!doc) return;

    doc.open();
    doc.write(html);
    doc.close();

    // The logo image needs to load before printing.
    const img = doc.querySelector("img");
    const doPrint = () => {
      frame!.contentWindow?.focus();
      frame!.contentWindow?.print();
    };

    if (img && !img.complete) {
      img.onload = doPrint;
      img.onerror = doPrint;
    } else {
      // Small delay for styles to render.
      setTimeout(doPrint, 100);
    }
  }, []);

  return print;
}
