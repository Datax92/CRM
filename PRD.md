# PRD — Lead Management & CRM Platform

**Status:** Draft for engineering handoff · **Source:** CRM_System.pdf (client proposal) · **Owner:** you (Admin/Product)

---

## 1. Purpose

A centralized CRM that ingests leads from Meta Ads, distributes them fairly to employees under
Admin-defined priority, tracks every follow-up immutably, records closed-deal financials, and gives
management real-time visibility into pipeline, performance, campaigns, and profit.

**Primary success measure:** zero leads sit untouched past the monitoring window, and every closed
deal has a complete, auditable trail from ad-click to profit entry.

---

## 2. Roles & Permissions

| Capability | Admin | Employee |
|---|---|---|
| Create/disable/remove employees, set priority | ✅ | ❌ |
| See all leads / all employees' data | ✅ | ❌ (own leads only) |
| Manually assign a new lead (5-min window) | ✅ | ❌ |
| Accept/work an assigned lead, log follow-ups | — | ✅ |
| Edit or delete a submitted follow-up | ❌ | ❌ (immutable for everyone) |
| Reassign leads | ✅ | ❌ |
| Record expenses, view financial dashboard | ✅ | ❌ (sees own revenue/profit only) |
| Enter a closed deal | ✅ | ✅ (their own leads) |

---

## 3. Core User Stories

**Lead intake & assignment**
- As Admin, I see every new Meta lead the moment it lands, so I can hand-pick who works it.
- As Admin, if I don't act in 5 minutes, I want the system to assign it for me so nothing stalls.
- As Employee, I want 10 minutes to accept a lead before it's taken from me, so a missed
  notification doesn't unfairly cost me a lead — but I also don't want to be able to sit on leads.

**Follow-up & communication**
- As Employee, I want to log every call/WhatsApp touch against a lead so my work is visible.
- As Admin, I want follow-ups to be permanent once submitted, so records can't be quietly edited
  after the fact.

**Money & performance**
- As Employee, I want to record a closed deal's received/payable amounts and see profit calculated.
- As Admin, I want revenue, profit, and expenses rolled up by employee, campaign, day/week/month.

**Oversight**
- As Admin, I want a red flag the instant a lead expires unaccepted, so I can intervene same-day.
- As Admin, I want a reminder if a lead has no follow-up logged, so nothing goes cold silently.

---

## 4. Functional Requirements by Module

### 4.1 Employee Management
- FR-1 Admin creates employee (name, credentials), edits info, sets/changes priority rank.
- FR-2 Admin activates/disables/removes an employee (disable ≠ delete — see BR-22).
- FR-3 Disabling blocks login and future assignment; existing active leads become reassignable by Admin.

### 4.2 Meta Ads Lead Intake
- FR-4 New Meta Lead Ads leads enter the CRM automatically (webhook or polling — see Architecture §2).
- FR-5 Each lead captures: name, phone, email (optional), campaign/ad, timestamp, source, status,
  assigned employee, follow-up history.
- FR-6 Every lead is tagged to a campaign/ad category for later reporting.

### 4.3 Lead Distribution
- FR-7 New lead appears on Admin Dashboard with a **5-minute** manual-assign countdown.
- FR-8 If Admin assigns within the window → lead goes to the chosen employee, timer stops.
- FR-9 If the window expires → automatic distribution takes over using employee priority + the
  **8-lead rotation rule** (see Architecture §4.2 for the concrete algorithm — the source proposal
  describes the *rule* but not the exact tie-break math, so this is formalized in engineering).
- FR-10 Assigned employee has **10 minutes** to accept.
- FR-11 No acceptance in time → lead auto-reassigns to next-priority employee, a Red Flag event is
  recorded, Admin dashboard shows the alert.

### 4.4 Lead Record & Status
- FR-12 Lead profile shows basic info + full communication history.
- FR-13 Status values: New, Assigned, Accepted, Contacted, Follow-Up, Interested, Negotiation,
  Closed/Won, Closed/Lost, Not Interested, No Response.

### 4.5 Follow-Ups
- FR-14 Lead detail starts with 5 follow-up slots; a "+ More Follow-Up" control adds unlimited more.
- FR-15 A follow-up captures: message, call made (y/n), call count, WhatsApp note, date/time.
- FR-16 **Once submitted, a follow-up is permanently read-only** — no edit, no delete, by anyone,
  including Admin. Corrections happen via a new follow-up entry.
- FR-17 Manual WhatsApp: employee uses the customer's number (click-to-chat) and logs what was sent —
  the CRM does not send messages itself in Phase 1 (see §6 Out of Scope).

### 4.6 Monitoring & Alerts
- FR-18 If an employee holds a lead with no follow-up logged inside the monitoring period, Admin
  gets a reminder naming employee, customer, campaign, assignment time, status. *(Exact monitoring
  period is not specified in the source doc — default proposed: 24 business hours, configurable.)*
- FR-19 Admin alert types: unassigned lead, missed acceptance, no-follow-up, red flag reassignment.

### 4.7 Closed Deal / Entry Module
- FR-20 On conversion, employee enters customer info + Amount Received + Payable Amount.
- FR-21 System computes `Profit = Amount Received − Payable Amount`.

### 4.8 Performance & Ranking
- FR-22 Per-employee metrics: assigned/accepted/missed leads, follow-ups, calls, WhatsApp logs,
  closed clients, revenue, payable, profit, conversion rate, pending/active/lost leads.
- FR-23 Daily/weekly/monthly rollups per employee.
- FR-24 Ranking by leads handled, follow-ups, closes, revenue, profit, conversion rate, missed leads.

### 4.9 Campaigns
- FR-25 Per-campaign: leads, closed count, revenue, profit, conversion rate.

### 4.10 Expenses & Financials
- FR-26 Admin logs expenses (title, category, amount, date, description, added-by, optional note/doc).
- FR-27 Categories: Rent, Salaries, Internet, Electricity, Water, Bills, Marketing, Software, Other.
- FR-28 Financial dashboard: total revenue, payable, gross profit, expenses, **net profit**.
  `Gross Profit = Received − Payable`, `Net Profit = Gross Profit − Expenses`.

### 4.11 Audit Trail
- FR-29 Every lead retains: intake time, source campaign, admin-view time, who assigned it, accept
  time, expiry/reassignment events, follow-up log, status changes, close date, financial entry.

### 4.12 Search
- FR-30 Global search/filter by customer, phone, email, employee, campaign, status, date, closed state.

---

## 5. Business Rules (authoritative — engineering must not deviate without sign-off)

| # | Rule |
|---|---|
| BR-1 | Admin creates employees manually. |
| BR-2 | Admin sets employee priority. |
| BR-3 | New Meta leads land on the Admin Dashboard first. |
| BR-4 | Admin has exactly 5 minutes to manually assign a new lead. |
| BR-5 | Missed window → automatic assignment begins. |
| BR-6 | Auto-distribution = priority order + 8-lead rotation. |
| BR-7 | Employee has exactly 10 minutes to accept an auto-assigned lead. |
| BR-8 | No acceptance in time → lead moves to next-priority employee. |
| BR-9 | Every non-acceptance raises a Red Flag to Admin. |
| BR-10 | Employees only ever see their own leads/data. |
| BR-11 | WhatsApp contact is manual (click-to-chat), not automated, in Phase 1. |
| BR-12 | Employees log all communication/follow-up in-app. |
| BR-13 / BR-14 | Submitted follow-ups can never be edited or deleted. |
| BR-15 | Unlimited additional follow-ups via "+ More Follow-Up." |
| BR-16 / BR-17 | Admin can monitor employee progress and every follow-up per customer. |
| BR-18 | Closed customers must go through the Entry Module. |
| BR-19 | Financial entry = amount received, payable amount, profit. |
| BR-20 | Admin manages office expenses. |
| BR-21 | Admin gets reminders for leads with no follow-up activity. |
| BR-22 | Disabling an employee preserves their historical records — never hard-delete. |

---

## 6. Out of Scope for Phase 1 (explicitly future work per the source proposal)

WhatsApp Business API automation, automated messaging/templates, email/SMS integration, AI lead
scoring/prioritization, advanced pipeline stages, customer segmentation, multi-admin accounts,
team-based permissions, Excel/CSV/PDF export, call recording integration, payment integration.

---

## 7. Non-Functional Requirements

- **Security:** JWT/session auth, RBAC (Admin vs Employee), password hashing, per-employee data
  isolation at the query layer (not just UI hiding), audit logging, no destructive edits to closed
  historical data.
- **Reliability of timers:** the 5-minute and 10-minute windows are business-critical and must fire
  even across server restarts/deploys — this rules out an in-memory `setTimeout` approach (see
  Architecture §6).
- **Responsiveness:** Admin dashboard optimized for desktop (data density); Employee side must work
  well on both desktop and mobile.
- **Auditability:** nothing that affects money or follow-up history is ever hard-deleted.

---

## 8. Open Questions (flag to client/Admin before or during build — don't let the agent silently assume)

1. **8-lead rotation** — is it "8 leads per employee before rotating to the next priority tier," or
   "every 8th lead overall rotates," or something else? A concrete algorithm is proposed in
   `architecture.md §4.2`; confirm it matches intent before relying on it.
2. **No-follow-up monitoring period** — proposal doesn't give a number. Default assumed: 24 business
   hours, admin-configurable per priority tier if needed.
3. **Multi-currency?** Assumed single currency for Phase 1.
4. **What happens to a lead that cycles through every priority employee without acceptance?** Not
   specified — proposed default: it falls back to the Admin's manual-assignment queue with a
   dashboard alert, rather than looping forever.
5. **Deal-entry gate** — can only the assigned employee (or Admin) create a Closed Deal entry for a
   given lead? Assumed yes.
