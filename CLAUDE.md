# CRM — Agent Context

Lead Management & CRM for Meta Ads intake, fair employee distribution, immutable
follow-ups, attendance, payroll and financial reporting.
**Admin → Sub Admin (Manager) → Employee.**

## Docs (read before building)

| File | Purpose |
|------|---------|
| `PRD.md` | Product requirements, roles, business rules (BR-1–BR-22) |
| `architecture.md` | Tech stack, Firestore model, assignment/accept timers, security |
| `docs/implementation-notes.md` | **Shipped vs planned** — Server Actions + cron sweep instead of Cloud Functions/Tasks |
| `docs/deployment-runbook.md` | Deploy steps |
| `docs/design/*.dc.html` | The authoritative design files. Transcribe values from these, never measure a screenshot |
| `files.md` | Full repo tree |

## Stack

- **Frontend:** Next.js App Router on Vercel (`src/app/`)
- **Backend:** Firebase (Auth, Firestore, Storage) — privileged writes via Server Actions (`src/app/actions/`)
- **Timers:** deadline timestamps + `/api/cron/process-deadlines` (never in-memory `setTimeout`)
- **Meta intake:** `/api/webhooks/meta`
- **Demo mode:** `src/lib/demo/store.ts` — in-memory mirror of every action. Keep it in step with the real path or the two surfaces drift.

---

# Business rules

## Distribution & acceptance

- New leads sit in the admin queue for a **5-min manual assign window**, then auto-distribute.
- Auto-distribution sorts by **priority 1–10** (1 = front) with an **8-lead rotation** — after 8 consecutive leads the next employee starts the cycle. Rotation governs incoming volume only.
- The assigned employee has a **5-min accept window**. On a miss the lead cascades strictly down the priority lane, skipping anyone who already let it expire (`resolveCascadeAssignee`), and a `RED_FLAG` notification + `missedLeadsCount` increment is recorded.
- **The lane has a floor.** When one candidate remains — or everyone has had a turn — that employee is *force-accepted*: no window, no decline. A lead cannot reach `UNASSIGNED_NO_CAPACITY` while an active roster exists.
- **Admin actions bypass the lane.** Assign, reassign and promote write `ACCEPTED` + `acceptedAt` immediately and delete `acceptDeadlineAt`. An admin handing out a lead is a decision, not an offer.
- **The cascade never advances rotation counters.** Cleaning up a colleague's miss must not consume your turn.
- `autoAssign: false` takes someone out of distribution *and* the cascade while leaving them able to receive a manual assignment. Absent means in the lane.
- Closed leads (Closed Won / Closed Lost / Not Interested) cannot be reassigned.
- Windows and the 1–10 scale are defined once in `src/lib/constants/distribution.ts`, including the minute figures used in user-facing copy, so wording cannot drift from the clock.

## Leads

- **The pipeline is inbound only.** Meta Ads intake plus records promoted out of the Data Bank. There is no Add Lead on the leads screen. (`AddLeadModal.tsx` / `MobileAddLead.tsx` are kept, complete and unused, for a possible one-off referral case.)
- **Pipeline Status** is the formal state machine (`leadStatus.ts`). **Pipeline Stage** is the commercial read — **Cold → P3 → P2 → P1** — derived from status by `STATUS_STAGE` and rendered by `pipelineStage.ts`. Stage is a read-out, not a control; the status select is grouped by band so choosing a status shows what it does.
  - P3 talking (Accepted → No Response, **Negotiation**) · P2 they showed up (Meeting Done, Site Visit Done) · P1 closing (Document Received, Token Received, Deal Closed).
  - **Accepting a lead is not progress on it.** A lead at ACCEPTED with no entries carries **no band at all** (`awaitingFirstEntry`); writing its first Remark makes it P3. Every other P3 status is a deliberate act by a person, so those take the band immediately. Derived from `followUpCount` — no backfill, nothing to go stale.
  - `tokenReceivedAt` is stamped one-way when the status first reaches TOKEN_RECEIVED. The status moves on to Deal Closed; the fact that token money arrived does not, so the report reads the stamp rather than the current status.
- **Cold is decided, not inflicted.** `meetsColdRule` (10 follow-ups without reaching Seems Interested) raises `coldPending` and notifies the admin *and* the lead's manager once, guarded by `coldReviewRequestedAt`. `reviewColdLead` writes the decision; dismissing clears the flag so the rule can raise it again. The employee is told either way.
- **Lead source names the exact origin** — `Data Bank (Facile Town 2)`, `Meta Ads (Ramadan Offer)` — from fields denormalised onto the lead at creation, never a live join (`lib/leadSource.ts`). A folder rename must not rewrite a lead's recorded origin.
- **Entries: the first is a Remark, the rest are Follow-Ups.** `kind` is now *stored* (the day rule has to know whether the Remark exists before writing); `lib/followUpKind.ts` still labels older entries by position. `entryAllowance`: day one takes a Remark *and* a Follow-Up, every later day one Follow-Up. Admins are exempt from the per-day cap.
- **Only the newest entry is editable, for every role including admin.** Editing appends the previous values to `revisions` with who and when, and moves the KPI counters by the delta. The lead names it in `latestFollowUpId` — and **where that field is absent**, on leads whose entries predate it, the newest is resolved from the subcollection by `occurredAt`, which is the order the pane displays. It used to read `if (lead.latestFollowUpId && …)`, so on exactly those leads the guard evaluated false and the rule stopped existing: every entry was editable. The pointer is written back on the first edit, so each such lead repairs itself.
- **Entries are numbered along the list, not against it.** `index` is the position in the *chronological* array: the Remark is named rather than numbered, and each Follow-Up after it is #1, #2, #3. Counting down from `length` numbered a five-entry lead #4, #3, #2, #1 and left the newest — the only editable one — with no number at all.
- **Deal Closed is not in the status dropdown.** `setLeadStatus` refuses `CLOSED_WON` outright, because a won deal has to come through Deal Entry so the customer record and the amounts are captured. Offering it was offering a choice that could only produce an error, which read as the status refusing to change.
- History renders **chronologically** (`toChronological` at the point of display). Queries, `latestFollowUpId` and the edit-the-newest rule all stay newest-first.
- **KYC is the client record and every field is optional** — including the name. Saving it rewrites the lead's name / phone / email / city and pre-fills Deal Entry, all in one transaction (`lib/kyc.ts`). An incomplete KYC saved on the first call is the normal case.
- A follow-up recording a meeting sets `meetingHeld: true` on the lead, one-way.
- Follow-ups are append-only; only the newest is editable, and editing keeps the previous values.

## Hierarchy & scope

- An employee's manager is `users/{uid}.subAdminUid`; a folder's owner is `dataBankFolders/{id}.subAdminUid`; leads and deals carry a denormalised copy. Absent means "the admin, directly".
- **Never a list on the manager.** A Security Rule cannot prove a list query against a scope held in another document, so every sub-admin query is `where('subAdminUid','==',me)` and every rule mirrors it exactly.
- **Two levels deep only** — a sub admin never reports to a sub admin. A chain would make "whose team is this" a graph walk, and rules cannot walk graphs.
- Moving somebody between teams re-stamps their leads and deals in paged batches (`reassignTeamOwnership`) — deliberately not a transaction; a half-finished run leaves stale ownership rather than corruption, and re-running finishes it.
- **The admin edits a manager from the manager's own record, not only from the card.** `DirectoryView` owns `ManagerFormModal`, because it has to open from two places — the manager card and the Edit inside their dossier — and a modal owned by `SubAdminPanel` could only open from that panel. The dossier's Edit picks the form by subject: the Manager form for a manager, the Employee form for an employee. It briefly had none at all for a manager, on the reasoning that offering the wrong form is worse than offering none; the cost of that was an admin who could open a manager and change nothing about them, not even Active/Inactive.
- **A Manager is not an employee.** Own Add Manager form: no lane priority, no KPI targets, no auto-assign, no job title, no leads. Their analytics are **their team's plus their own**, summed on read (`lib/managerMetrics.ts`) with conversion team-wide (won ÷ handled), never an average of per-person rates — the same set `reportScope.teamOf` builds, so the directory card, the manager's dossier and Reports agree on one number. `headcount` stays the *team* size. **Clicking a manager opens the same `EmployeeDetailModal` an employee row does**, given their team: pass `team` and it is a manager's dossier (Team Leads / Deals / Team / Activity / Analytics, team-scoped), omit it and it is an employee's. One component, because two would drift. Their lead view is read-only for **their team's** leads — the server books follow-ups and deals against the *assigned employee*, so a manager logging one would credit somebody else's KPI. **A lead assigned to the manager themselves is theirs to work**: a Data Bank record promoted into their Client section, or one handed to them, carries `assignedUserId = their uid`, so the entry credits them. `canWorkLead` always allowed it; only the two panes refused, which is why a manager could open a lead in Clients and not write a word on it.
- `managerKind` (SALES / HR) rides in the **auth claim**, because the sidebar must know before it can draw. Changing it re-issues the claim and revokes the token. An older manager with no claim reads as SALES.
- Employees see only their own leads; a sub admin only their team's — enforced in rules *and* server actions. **Every read hook takes a scope for this reason**, not as an optimisation: `useLeads`, `useEmployees`, `useDataBankFolders`, `useFinancials` and `useClientFolderMembers` all add the clause their rule checks, and an unscoped list query is refused outright rather than returning less. This has now shipped as a bug three times — the symptom is always a screen that renders with *nothing in it* rather than an error.
- **The admin directory and a sub admin's Team page are one component** (`DirectoryView`), because two implementations of "the team" drift. Every mutating employee action is `requireAdmin`, so a sub admin gets the same screen with those controls **absent** rather than present and failing.

## Money

- **A deal is four figures.** Total Price and Down Payment are typed, Adjustment is typed when there is one, and **Remaining = Total Price − Adjustment** is calculated and read-only. `lib/dealAmounts` owns the arithmetic and the form, the phone and the Server Action all run it, so a deal cannot come out differently depending on where it was entered.
- **The commission base is Remaining, and that is one rule, not two.** The owner stated it as two cases — the cut comes off the Total Price, or off the Remaining if there was an adjustment — but with no adjustment Remaining *is* the Total Price, so a single expression covers both and there is no branch to wire up backwards. On the worked example: 50 lakh total, 10 lakh adjustment, base 40 lakh; 1% to the employee is 40,000. Every percentage on the distribution screen is a percentage of this.
- **The Down Payment funds the payouts; it never changes them.** It is what the client has actually handed over, so the distribution screen shows it beside the allocated total and says how much of it is left — or how far past it the split goes. Shown, never enforced: a shortfall is often covered elsewhere, and refusing the split would be that screen inventing a rule about the company's cash flow.
- **The company still banks the remainder**, exactly as before — its own percentage plus everything nobody was allocated. Confirmed by the owner when the base changed.
- `amountReceived` and `payableAmount` are still written, as **mirrors**: `amountReceived := totalPrice`, `payableAmount := adjustment`, so the old `profit = received − payable` lands exactly on the new base. That is why ~30 readers — every revenue rollup, the KPI portfolio, the income sheet, campaign ROI, employee metrics, Reports — needed no change and no historical deal needed migrating. Nothing new should read them; use `lib/dealAmounts`, whose accessors fall back for older deals. `readDownPayment` returns **null**, not 0, for a deal closed before the form asked — a confident `Rs 0` reads as a client who paid nothing.
- Profit = the commission base; net profit = gross − expenses.
- **A closed deal waits for the admin to split its profit.** `closeDeal` writes `distributionStatus: 'PENDING'` and notifies the admin.
- `dealDistributions` holds the whole split (**admin only**); `dealPayouts` holds one row per recipient (that person, their sub admin, the admin). Two collections because Firestore grants a whole document or none — one document holding all four lines could never satisfy the privacy rule. The company's share is never written to `dealPayouts`.
- Over-allocation is **refused, not clamped**. The remainder is the company's and is reported as its own line *and* inside the company total.
- **Re-finalising supersedes, never overwrites** (`current: false` + `supersededAt`).
- **Closed Deals is the historical record**, assembled on read: frozen facts from the deal, live ones from the lead (KYC, origin, assignment), the split from `dealDistributions`, history from the lead's follow-ups. Reopen lives on the distribution page, beside the thing it undoes.
- **Payroll:** `DRAFT → REVIEWED → APPROVED → PAID`, one step at a time, **`PAID` is terminal**. `isEditable()` is the single predicate every write path asks. Approving *copies* lines into `payslips/{uid}_{YYYY-MM}`; reopening marks them `current: false`. Commission is dated by the month the split was **finalised**, not the month the deal closed.
- Salary figures: HR yes, other managers no, anyone else needs `salaryAccess: true` set per person. Marking a payroll **paid** is the admin's alone.
- **Office expenses** extend the existing `expenses` collection. Records written before the module read as approved. Charts count **approved spend only**; total (invoiced) and spend (approved) are both shown. Renaming a category moves its records in batches; removing one does not. An approved expense is rejected, never deleted.

## Attendance

- **Presence is declared** (Check In / Check Out). **Location has two checks, and they are not equally strong.** Both are judged on the server; a client-side verdict would be bypassed by editing one response.
  - **Where the device is** (`classifyLocation`) — the browser's geolocation, against the office's marked coordinates. **This is the check that answers the question**: a saved Wi-Fi name travels home in somebody's pocket, a position does not. Faking it needs a mock-location app or devtools; *forgetting* to fake it is impossible, which is the whole difference.
  - **The Wi-Fi network name** (`classifyWifi`) — corroboration, and the answer for a device that will not share a position at all.
  - **The IP allow-list was removed, not tuned.** A business line's public address is dynamic: the ISP hands out a new one on reconnect, a list built from today's address silently stops matching, and the restriction then refuses the entire company. That is the mechanism being wrong for the network, not a value needing adjustment. The address is still **recorded** on every punch (`checkInIp`, `lastIp`) and shown on the day's record — it is what an admin checks a suspicious day against — but nothing is ever matched against it and there is no list to maintain.
  - **No browser exposes the SSID.** There is no web API for it, on any platform. So the name is typed once per device, kept in `localStorage` (`useStoredNetworkName`, read through `useSyncExternalStore` — a `localStorage` read in a render body and a `setState` in an effect are both rejected by the lint rule), sent with the punch, and compared **on the server**.
  - **What makes a declared signal hold up is that it is never blind.** The accepted names are never shown to an employee — not in Settings they cannot open, not in the punch control, and **not in the refusal message**, which names only what *their* device claimed. A check whose expected answer is printed on the failure screen is a prompt, not a check. Every refused check-in is written to `users/{uid}.lastRefusedCheckIn` and **notifies the admin, HR and the employee's own manager**, once per employee per day. Bypassable but visible is the achievable goal; unbypassable is not.
  - The refusal is filed on the **user** document, never on `attendance/{uid}_{dayKey}`: creating that document with no `firstActionAt` would make a refused attempt look like an opened day, and `deriveStatus` grades a day with no activity as absent. A refusal must not change anybody's attendance.
  - **The radius is compared against the distance alone**, never against distance minus the error bar. Subtracting the accuracy is how a 150m rule quietly becomes a 400m one that the admin who typed 150 cannot see. Accuracy is used for exactly one thing: throwing out readings vaguer than `MAX_FIX_ACCURACY_METERS` (200m), which come back **`IMPRECISE`** and are asked to retry — never `AWAY`. A laptop positioning itself from surrounding Wi-Fi is routinely a kilometre out, and refusing that person as though they were at home would be wrong. Set the radius generously instead; it is a number on a screen somebody can change.
  - **The office is marked by standing in it and pressing a button**, not by typing coordinates. An admin who has to look up their own latitude will transpose it, and a wrong office refuses the entire company. Settings refuses to pin the office from a reading vaguer than 200m for the same reason.
  - `resolveNetwork` lets **location win outright** when it has an answer — an office day whose network name was never set is still an office day, and a day five kilometres away is remote whatever the device typed. The Wi-Fi name is the fallback only when location knows nothing.
  - **Location is read only at the moment Check In is pressed** — `withLocation` is passed for `kind === "IN"` and nothing else, so no other screen triggers a permission prompt. A prompt on a screen that has no use for the answer teaches people to hit Block, and somebody who has blocked it cannot check in at all. `PunchRulesHint` says so *before* the browser asks.
  - A device that will not give a position sends its **failure code** to the server rather than giving up locally: the refusal is the server's to make and to record, and deciding locally would lose the one event an admin needs to see.
  - `getPunchRequirements` tells the punch control whether to ask for a name and whether to ask for a position — booleans only, **never the office coordinates**, which a client that knew them could send straight back — a boolean and nothing else, because `config/attendance` is admin-only and a dropdown of accepted names would hand over the answer. It is **re-asked after a refused punch**, or a browser open since before the admin switched the rule on would be told to use a box that is not on its screen.
- **Check-in is refused off the office network; check-out never is.** Blocking a check-out would strand an open day, and an open day grades as a half day.
- `locationRestriction` absent + a marked office ⇒ **enforced**; `wifiRestriction` absent + `officeWifiNames` non-empty ⇒ **enforced**. Absent + empty ⇒ not enforced (nothing to enforce against, and refusing everybody locks the company out — the exact failure the address check produced). Explicit `true`/`false` always wins, and Settings always sends the field. Saving either restriction on with nothing behind it — no office marked, no names listed — is refused. A coordinate is kept only as a **pair**: half an office is no office, and `0,0` is in the Atlantic, which is what an unset field looks like. `ipExemptUids` keeps its stored name — renaming it would empty every existing exemption list on the next read — and means "may check in from any network".
- Unconfigured is **`UNKNOWN` ("Unverified")**, never "Remote" — a month of "Remote" must be distinguishable from a setting nobody filled in.
- Statuses are PRESENT / **LATE** / ABSENT / LEAVE, each carrying a letter as well as a colour. An override wins everywhere, including the deduction, and is stored *beside* the observed times.
- `deriveStatus(0, true)` is `HALF_DAY` — a day checked in but not out is never graded absent. Half days count as **half** in the rate.
- Both punch buttons stay on screen all day; a control that disappears leaves no way to see what state you are in. **There is exactly one punch control in the app: the `/home` strip.**
- Approved leave leaves the denominator rather than counting against the employee. A request over balance is allowed to be *sent* — the form says how far over and the approver decides.
- **A closed month is frozen.** `finalizeAttendanceDeductions` copies the amounts, the salaries behind them and the rule each charge was made under, in words, into `attendancePeriods/{YYYY-MM}`. Open months recompute live. Reopening is its own action.
- `recordAttendancePing` is kept but no longer called — it is the only writer that could reconstruct a day from observed activity.

## KPI

- MTD = month-to-date, YTD = year-to-date, and a KPI percentage is **actual ÷ target**. `lib/kpi.ts` takes both, never a pre-computed percentage. YTD target = monthly target × months elapsed.
- Three metrics: **Connects** (a typed call duration ≥ `CONNECT_MIN_SECONDS` = 70s), **Client Registration** (closed deals), **Meeting** (the meeting tick). Defaults 200 / 8 / 20 a month, overridable per person. `targets.revenue` (default PKR 3,000,000) is the Target Achieved denominator and is deliberately outside `KPI_METRICS`.
- **The connect flag is computed server-side** from the typed duration, never read from the client payload.
- Counters (`users/{uid}/kpiMonths/{YYYY-MM}`) are incremented **inside the same transaction as the work they count**, credited to `lead.assignedUserId` rather than the author, and dated by when the work happened — so a backfilled March deal lands in March.
- **There is no backfill.** Counters only count work logged since the KPI module shipped; a real account starts near 0% and climbs. Writing one needs a decision on whether historical calls, whose duration was never recorded, may count as Connects. They cannot be verified after the fact.
- `kpiScore` weights the three 40/40/20 with each **capped at 150% first**, or one runaway metric masks two failing ones. `recalculatePriorities` ranks the active roster and assigns 1..N, ties broken on uid; **an admin-pinned priority (`autoPriority: false`) is never moved**. Shared by the button and the 00:30 PKT cron.
- **The dossier's activity cuts partition the worked leads.** Remarks is *exactly one
  entry* — the first follow-up moves a lead out of it — and Follow-ups is two or more.
  Connected cuts across both, reading `connectCount`, so a call under 1:10 is contact
  and not a connect.
- **A dossier period means "worked in", a report column means "entries written".** They are neighbouring questions and were being read as the same one. An employee's dossier counts **leads** and filters the period on **last touch** (`applyLeadFilters`); Reports counts **entries** in the range. Somebody who logs 30 follow-ups today across 30 leads is `30 / 41 worked` on their record and `5 Remarks + 25 Follow-ups` in Reports — both right. The dossier used to filter on `createdAt`, which answered "which of their leads were *created* today" and showed **nothing at all** for that employee; the two screens then looked like they were contradicting each other. The chip hints name their unit for the same reason.
- Reports (`buildTeamReport`, a Server Action) have **one subject at a time** — an employee, a manager (their own work *and* their team's), the admin, All Employees, or All Managers. Every figure is built per person once (`lib/reportScope`), and a composite subject is the sum of a *set of people*, which is what makes double-counting impossible rather than merely unlikely. New Connects is the *first* connected contact on a lead (its Remark), Follow-up Connects every later one — disjoint, or the columns sum to more than the work that happened. **Remarks and Follow-ups count every entry, connected or not**, and are deliberately not disjoint from the connect columns: a day of unanswered calls is real work and must not read as a zero. The activity columns are range-scoped; P1/P2/P3 describe where the leads stand today and say so.

## Data Bank & Clients

- Cold lists live apart from the pipeline: `leads` is a small live working set, a source export is 20,000+ rows. Mixing them would slow every pipeline query.
- **Both managing roles build folders.** Create, rename and delete are a manager's as well as the admin's — a walk-in sheet or an event sign-up is a manager's own cold list, and refusing it left their Data Bank holding nothing but the mirrors an admin had handed them. What stays the admin's is *whose* folder it is: `createDataBankFolder` takes the owner from the caller's **token** for a manager, and `updateDataBankFolder` ignores the owner field for them entirely, so a folder cannot be filed under — or taken from — somebody else. Adding and importing records were already `requireManager`; only folder creation was not, which is why a manager appeared to be able to do neither.
- **A Client folder is not created by hand.** It holds leads that already exist, so an empty one is a container with no way to fill it; every route in is a promotion from the Data Bank. "New Folder" was removed from the Clients screen for that reason — it was the one of the two screens where the button led nowhere. Rename and delete stay.
- **A column can name where its value belongs.** Each folder field takes an optional `mapsTo` — `deal:totalPrice`, `kyc:cnic`, `lead:city` — set from a "Fills in" picker beside the column. At **promotion** the mapped values are copied onto the lead: `kyc` pre-fills the KYC tab, `dealDefaults` pre-fills Deal Entry, and email/city land on the lead itself. A society export already knows the plot's price and the buyer's CNIC; retyping them is where the two records start to disagree.
  - **Copied once, at promotion — never read through afterwards.** A cold row is provenance, a lead is a working record somebody edits. Reading live would make a corrected KYC revert to whatever the spreadsheet said, and a re-import rewrite a lead nobody touched. Same rule `lib/leadSource` follows.
  - **`deal:remaining` is not offered** — it is calculated from the other two, so a column filling it could contradict them. Neither are name and phone, which every folder already nominates through `roles`.
  - A price cell holding `"TBC"` yields nothing rather than a confident zero, and an empty cell is skipped rather than written as `""` — an unfilled KYC field and a deliberately blanked one look identical in Firestore and only one should count toward `kycCompleteness`.
  - `lib/fieldMapping` imports **nothing**, because it is unit-tested under the raw `--experimental-strip-types` loader; `lib/fieldMappingTargets` holds the labels and is where `KYC_FIELDS` is read.
- **Fields are per folder**, labelled in the source's own words. One is designated the name and one the phone — without them the app cannot dial, dedupe or promote. **Keys are generated and permanent; only labels are editable.**
- Import maps columns rather than matching header names exactly, remembers corrections on the folder, and dedupes on a normalised phone key (`0300 1234567` / `+92 300…` / Excel's zero-eaten `3001234567` all collapse to one). Junk yields `""`, which never matches.
- **Nothing is dropped silently** — `prepareImport` reports every rejected row by line number. Existing numbers are skipped, never overwritten, and **a row handed to a manager still counts as held**: the dedupe scans the folder plus its mirrors (one query each, reusing the `folderId, phoneKey` index, and skipped entirely when `handedOffCount` is 0), or re-importing last month's sheet would recreate every handed-over row and put two people on one number.
- CSV is parsed in-house (quoted fields, embedded newlines, CRLF, the UTF-8 BOM). **.xlsx is still not parsed** — the importer says so and points at Save As → CSV.
- Chunks close on **whichever ceiling comes first, rows or bytes** (`chunkRowsByPayload`); a 500-row chunk of a 40-column sheet serialises to 1.93 MB against Next's 1 MB Server Action limit. `next.config.ts` sets `bodySizeLimit: 4mb` as headroom — raise the two together or not at all. Chunks stay sequential: each one's duplicate check reads what the previous committed.
- Records are **cursor-paged** (`CursorPager`, no page numbers) — this is the one list that can hold 40,000 documents.
- **Promotion moves, it does not delete.** The batch writes the lead, its event, its notification and re-parents the row to `PROMOTED_FOLDER_ID`; the tombstone is deleted afterwards, outside the batch, where failing costs nothing. `promotedLeadId` guards double promotion; `deleteDataBankFolder` sweeps by `promotedFromFolderId`.
- **Three destinations, and they are not the same operation.** An **employee** is promoted a lead into their pipeline. The **admin / yourself** is promoted a lead into their Client section — `ensureClientFolder`, deterministic id `db_{uid}_{sourceFolderId}`, so next week's import of the same source lands in the folder that already exists. A **manager** is handed the *record*, moved into their own Data Bank in a mirror of the source folder (`assignRecordsToManager`, id `mgr_{uid}_{sourceFolderId}`, carrying the source's fields and keys verbatim) — they then distribute it to their team, or take it themselves. `option.action` on the assign list says which, so no call site infers it.
- **Rows move, they are never copied.** Two documents for one prospective client means two people ring the same number. The admin still sees handed-over rows: the mirror is badged with the manager's name, and the source folder counts them as `handedOffCount`.
- A lead promoted out of a mirror files under the **original** folder's Client mirror, or one source fragments into a folder per route it took.
- **A Client folder holds references, never copies.** Membership ids are `folderId__leadId`. Deleting a folder deletes an *organisation* of the pipeline, never part of it.
- Both collections are managing-roles-only. Readable by employees, this would hand every one of them an exportable copy of every number the business has bought.

---

# Design system

Tokens live in `src/app/globals.css` (`:root` + `@theme inline`, Tailwind v4).

**Teal, not the old slate/indigo.** `--color-background #e9f1f0` · `--color-surface #FFFFFF` ·
`--color-primary #4f9c99` · `-dark #3f8f8a` · `-deep #2f7d78` · success `#3f8f8a` ·
critical `#c0574a`. The **emerald ramp itself is redefined** to teal in `@theme`
(500 `#4f9c99`, 600 `#3f8f8a`, 700 `#2f7d78`) so every `emerald-*` in the codebase
inherits the brand without a 60-file sweep.

**Type is per design file, not app-wide.** Poppins (leads, default),
Plus Jakarta Sans (`--font-dashboard`, Day End Report), Manrope (`--font-directory`,
Employee Directory / Reports / Attendance). Each is applied by its own screen root.
An `<h1>` must set `font-family` **inline** — `@layer base` sets a family on `h1`–`h6`
and an element rule beats a family inherited from a container.

**Shared chrome to reuse rather than restate:**
`components/employees/directoryChrome.tsx` (`E` tokens, `HeroRings`, `Card`, `Bar`,
`ringDash`, `compactRupees`) is the language for directory, reports and attendance;
`components/dashboard/dayEndChrome.tsx` (`T`) for the dashboard;
`components/mobile/mobileChrome.tsx` (`M`) for every phone screen;
`components/ui/OverlayPanel.tsx` for every overlay;
`components/ui/AdminTable.tsx`, `CustomSelect.tsx`, `DateTimePicker.tsx`,
`DossierControls` (`Pager`, `CursorPager`) for the rest.

## Hard UI rules

1. **Below 820px the app renders a separate phone product** (`components/mobile/`), not the desktop tree reflowed. The switch is `useIsMobile` — a JS width read through `useSyncExternalStore` with a server snapshot of `false` — never a media query. 820 because the leads workspace needs its 372px list plus a readable pane and crushes at ~810.
2. **A layout that must be right on a machine we do not control is inline-styled or measured**, not left to a Tailwind arbitrary value or a rule in `globals.css`. See *Lessons* below.
3. `100dvh`, never `100vh`, on a full-height phone column; `env(safe-area-inset-*)` for the notch and home indicator. Never reproduce a mockup's drawn phone frame (9:41 clock, signal bars) — the device already has one.
4. Phone form inputs are **16px** or iOS Safari zooms the page on focus.
5. Every overlay portals to `document.body`. Scroll goes on the **body only**, so a long form cannot push its own Save button out of reach.
6. Text on a dark ground uses Slate 50 minimum (4.5:1). Nothing renders at 0 opacity or in its own background colour.
7. Wide content scrolls inside its own container; the page never scrolls horizontally. A money table becomes **cards** below 820px, carrying every figure and both actions — never a reduced version.
8. Grids: KPI 1 / 2 / 5, lead cards 1 / 2 / 3, folder and stat cards `auto-fill minmax(300px)` / `minmax(252px,1fr)`.
9. Motion is transform/opacity only, 220–420ms, staggered for the first ~8 rows only, and fully disabled under `prefers-reduced-motion`.
10. **A pager is hidden entirely when everything fits on one page**, and resets to page 1 only when the list *shrinks* (a filter), never when it grows (a live update).
11. **A headline describes the whole record; only the tab body follows the filter.** A total that moved when someone clicked "Inactive" would read as the team having shrunk.
12. **Read-state shading** (`useOpenedLeads`): unopened `#e2f0ee`, opened `#fbfdfd`, selected `#c6e0dc`, plus a dot and screen-reader text — colour is never the only signal.

## Routes

`/home` — Day End Report + the punch strip (every role) ·
`/admin/leads` (unified workspace; `/active|/new|/closed` redirect into `?filter=`) ·
`/admin/leads/campaigns` · `/admin/data-bank[/{folderId}]` · `/admin/clients[/{folderId}]` ·
`/admin/employees/directory` · `/admin/attendance/*` · `/admin/money` ·
`/admin/financials/{deals,distribution,expenses,payroll,reports}` · `/admin/accounts/*` ·
`/subadmin/{leads,team,data-bank,clients,earnings,money,attendance,salary,financials/*}` ·
`/employee/{workspace/leads,performance/stats,earnings,money,attendance,salary}`

---

# Lessons (paid for in production — do not relearn)

**Firestore rules & queries**
- A **list** query is checked against the rules *before* it runs and is refused unless its own constraints prove every document it could return is readable. Filtering in JavaScript afterwards does not count. Every scoped read carries `where('<owner field>','==',uid)` and every rule mirrors that clause exactly.
- On a **`get` of a document that does not exist, `resource` is null**, so `resource.data.x` errors and the client is told `permission-denied` rather than getting an empty snapshot. Split `read` into `get` (allows the null case) and `list`.
- **Composite index field order: equality fields in *alphabetical* order, then any range field, then the `orderBy`.** Indexes declared in the query's own order deploy successfully and are then never used.
- **Collection-group queries need an explicit field override**; Firestore's automatic single-field indexes are collection-scoped only. `followUps.dayKey` is the live example, and `buildTeamReport` carries a per-lead subcollection fallback so a missing index degrades to slow rather than broken.
- `npm run test:rules` (26+ assertions, needs Java + the Firebase CLI) is the only thing that catches this class. Typecheck, lint, unit tests and clicking around cannot.

**Firestore quota & transport**
- The free plan meters **reads, writes and deletes as three separate daily caps** (20k writes, 20k deletes, 50k reads). A 40,000-row import spends two days of writes in one action.
- **gRPC retries `RESOURCE_EXHAUSTED` indefinitely**, so the error never reaches an error path and surfaces as a 25s client timeout. `preferRest` therefore **defaults on** (`FIREBASE_PREFER_REST=false` opts out; the emulator forces gRPC). Over REST the same condition is a 429 in under a second. `lib/quotaError.ts` recognises all three shapes and routes them to one message naming both ways out.
- **Never make an operation hostage to a quota it does not need** — promotion once failed entirely because of one refused delete.
- `lib/watchGone.ts`: **the database is the answer, not the HTTP response.** Race a document listener against the action's return value; a write that commits is reported as successful even if the response never arrives. The action is still awaited, because only it can explain a *refusal*.
- Everything behind `withTimeout` says plainly that the work *may* have gone through — a timeout cannot cancel a request. Every such operation is safe to retry.
- `runAction` logs anything over 2s; `promoteDataBankRecord` logs an `auth / folder / commit` phase breakdown. "It is slow" is unanswerable without a measurement.
- `verifyIdToken(token, true)` is a **network round trip**, not a local verify. It is gone: `disableEmployee` writes `status: 'DISABLED'`, which `verifyAuth` reads anyway, *and* disables the Auth account and revokes refresh tokens.

**CSS that looks correct and is not**
- A **Tailwind arbitrary value only exists if the content scanner saw that exact string.** A stale cache or a partial copy drops the rule silently — the element renders with no background and the global `h1–h6` colour takes over. Critical screens are inline-styled.
- A rule in `globals.css` can be missing from a compiled stylesheet the same way. **Breakpoints that must not fail are measured in JS** (`useElementWidth` / `useIsMobile`), which also measures the *container* rather than the viewport, so a sidebar cannot fool it.
- **`will-change: transform` makes an element the containing block for its `position: fixed` descendants.** Every page is wrapped in `.animate-page-transition`, so an un-portalled `fixed; inset: 0` panel is pinned to the page's content box — cropped, offset, "stuck in half a window". Portal it.
- **Unlayered element defaults beat Tailwind utilities** regardless of specificity, because utilities live in `@layer utilities`. Element rules go in `@layer base`.
- `outline: none; ring: 2px` removes focus indication app-wide — `ring` is a utility name, not a CSS property.
- A flex child defaults to `min-height: auto` and will not shrink below its content: a scrollable nav needs `min-h-0`. A flex card's own footer needs `flexShrink: 0`.
- A flyout anchored `absolute left-full top-0` runs off the bottom of the screen on a long menu. Measure with `getBoundingClientRect()`, clamp into the viewport, render `position: fixed` (which also escapes every clipping ancestor), and close on scroll/resize because a measured position goes stale.
- A page that cancels `<main>`'s padding with a negative margin climbs over the navigation the layout renders above it. The shell owns the bleed, not the page.

**Server Actions vs the browser**
- The browser reads Firestore with the `NEXT_PUBLIC_*` config and the user's own token; Server Actions use `firebase-admin` and a **service account**. When the service account is missing, everything the browser loads keeps working and every action fails — the most misleading shape a failure can have. Never diagnose "one screen is broken" without checking which side it runs on.
- A `runAction` failure reaches the user as one generic sentence by design. Anything worth telling them apart — a spent quota, missing credentials — needs its own detector (`lib/quotaError`, `lib/configError`) or it is invisible.
- **Probe the running process, not a copy of it.** A throwaway API route doing one Admin SDK read answers "what does the *server* see" in seconds; a standalone script answers a different question and sent this project down the wrong path once already.
- A folder under `src/app` whose name starts with `_` is a **private folder** and is excluded from routing — a route placed in one 404s with no warning.

**React, and the shapes that look right**
- **Read `event.target.value` before the first `await`, never after.** A controlled `<select>` is re-rendered back to its prop the moment the handler yields, so `async () => act(await getIdToken(), …, e.target.value)` reads the **old** value — the server is asked for the status the lead already has, returns without writing, and the control snaps back. No error, nothing in the log, and it looks exactly like a dead dropdown. The phone's Pipeline Status had this; the desktop's did not, because it passed the value in synchronously.

**This project's conventions**
- The lint rule rejects `setState` in an effect body and impure calls (`Date.now()`) in a render body. Reset-during-render, or a `useCallback` registered from a browser event — not an effect.
- The raw `--experimental-strip-types` test loader cannot resolve extensionless imports — a module under test must not import `./dates`.
- **Recurring bug class: a field typed on a hook's `*Data` interface but never read out of the snapshot.** It has shipped four times (`phone`/`joinedAt`/`notes`/`autoAssign`, `monthlySalary`, the payroll fields, the client-folder fields). Check the mapper, not just the type.
- Derive on read (`pipelineStage`, `leadSource`, `followUpKind`, `managerMetrics`) rather than denormalising a computed value: every existing record is classified the moment the code ships, with no backfill to run and nothing to go stale. Denormalise only *provenance* — facts that must not change when their source does.
- Day keys are `YYYY-MM-DD` in **Karachi**, which makes string comparison date comparison. Seeds and sweeps keyed off UTC break between 19:00 and midnight UTC.
- Read state is per-browser, not a field on the lead: it changes on every click, differs per person and nobody audits it.
- One implementation, two sizes (a `variant` prop) — never a second component — or the surfaces disagree about the same number.
- A number a person could act on is never decorative sample data. A trend line that means nothing invites a decision from a shape.

**Testing**
- **Demo state is module memory**: a `page.goto` re-seeds the store and silently discards writes. Navigate in-app.
- A dev server left on the port makes `next dev` print `EADDRINUSE` and the test drives a **stale Server Action manifest** — presenting as `Cannot read properties of undefined (reading 'apply')`. Clear `.next` and fail loudly if the port is taken.
- Assert **computed values** (`getComputedStyle`, bounding boxes), never a screenshot.
- Reproduce the failure before fixing it — e.g. holding a Server Action's response back for 40s to manufacture the reported timeout.

---

# Operational state (2026-09-04)

**Baselines:** `typecheck` 0 errors · `test` **356/356** · `build` compiles ·
`eslint src` **7 pre-existing errors, 34 warnings** (unchanged for weeks — treat any
movement in these numbers as caused by the current work).

**Owed deployment — several features are inert until this is done:**
- `npm run deploy:rules` — rules for `leaveRequests`, `configHistory`,
  `attendancePeriods`, `payrollPeriods`, `payslips`, the Clients collections and the
  widened `expenses` read.
- ~~14 composite indexes and the `followUps.dayKey` collection-group override~~ —
  **done 2026-09-05.** The service account was granted **Cloud Datastore Index Admin**
  and `npm run deploy:indexes` created 13 composite indexes and the override.
  `npm run check:indexes` reports **nothing missing**, and `npm run diagnose:report`
  now completes the collection-group activity query in ~750ms instead of falling back —
  so Reports no longer shows its "ran the slow way" banner.

  Two lessons from that run, both worth keeping:
  - **IAM propagation is not instant.** The first `deploy:indexes` after the grant still
    returned `The caller does not have permission` on all 15. A
    `cloudresourcemanager … :testIamPermissions` call — which any principal may make
    about *itself* — proved the permissions were held, and the retry succeeded. Ask GCP
    what the key can do before concluding the grant went to the wrong principal.
  - **A single-field index cannot be declared as a composite one.** `dealPayouts
    .finalizedAt` and `expenses.dayKey` were one-field entries in
    `firestore.indexes.json`; Firestore refuses them with *"this index is not necessary,
    configure using single field index controls"* because it already indexes every field
    in both directions automatically. Both were removed from the file — left in, they
    would have reported as permanently "missing" and sent every future session hunting.
- `/api/cron/mark-absentees` (12:05 PKT) and `/api/cron/recalculate-priorities` (00:30 PKT)
  need `CRON_SECRET` — currently empty, so both cron routes refuse to run.

**Environment traps:** `.firebaserc` is gitignored, so `deploy:rules` targets whatever
`firebase use` selected; the runtime project is `leadway-crm` while
`src/lib/firebase/server.ts` still carries a hardcoded fallback of `leadway-496cd`.
On a dev server every request arrives as `::1`, so attendance check-in is refused
locally — that is the rule working.

**`FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` must be set, or every Server Action
fails.** Confirmed empty in `.env.local` on 2026-09-04 and the cause of a reported bug.
Without them the Admin SDK falls to Application Default Credentials, which exist on
Cloud Run / App Engine / after `gcloud auth application-default login` and **nowhere
else** — not on Vercel, not on a dev box. It then burns ~3s per call probing the
metadata server before failing. The browser is unaffected (it uses the `NEXT_PUBLIC_*`
config and the user's own token), so the symptom is "one screen is broken and everything
else works". `getAdminApp()` now warns at startup and `runAction` names the condition;
`npm run diagnose` times the transports and `npm run diagnose:report` replays the whole
report query sequence.

**`npm run set-admin-key`** installs a downloaded service-account key: it finds the
newest one in Downloads (or takes a path), refuses a key for the wrong project, writes
the three variables with the private key correctly escaped — `JSON.stringify`, because
one line of double-quoted PEM with literal backslash-n is the step that goes wrong by
hand — backs up `.env.local` first, and then proves the key with a live read. The key is never
printed. Backups and stray `*-firebase-adminsdk-*.json` files are gitignored.

**`npm run purge-all-data`** empties the live project: four groups
(`leads` / `employees` / `financials` / `data-bank`), dry run by default, two gates
(`--confirm`, then typing the project id back). Administrators and `config/*` are
preserved with no flag to override — deleting the admin locks you out of the app *and*
out of the script.

---

# Session log (last 5 days)

### 2026-09-05 (seventh round) — the deal becomes four figures, and a sheet column can fill them

**1 · Deal Entry: Total Price, Down Payment, Adjustment, Remaining.**
`amountReceived` / `payableAmount` are gone from every form. The arithmetic is
in `lib/dealAmounts` — pure, 20 tests, run by both forms and the Server Action —
and the rules are in **Business rules → Money**. The one that took a
conversation: the commission base is **Remaining**, and because Remaining
collapses to Total Price when there is no adjustment, it is a single expression
rather than a branch.

**The two old fields are still written, as mirrors.** `amountReceived :=
totalPrice`, `payableAmount := adjustment`, chosen precisely so the existing
`profit = received − payable` lands on the new base. Around thirty readers —
every revenue rollup, the KPI portfolio, the income sheet, campaign ROI, the
employee metrics, Reports — therefore needed no change at all, and no historical
deal needs migrating. Ripping them out would have been a thirty-file change with
thirty chances to get a money figure wrong.

**Asked before building, twice.** The base and the funding source were clear
from the owner's worked example (50 lakh / 10 lakh down / 10 lakh adjustment),
but the consequence was not: with the base becoming a sale price, the existing
"everything unallocated is the company's" rule would have reported ~39 lakh of
company profit on a 50 lakh deal. The owner's call was to keep that rule
unchanged, so it is unchanged.

**2 · A Data Bank column can say where its value belongs.** A "Fills in" picker
beside each column, offering Deal Entry / KYC / Lead targets; at promotion the
values are copied onto the lead. The owner's own **GFS Sheet** (267 rows) already
has a `Total Price` column — pointing it at Deal Entry → Total Price is now one
selection, and the price never gets typed again. Rules in **Business rules →
Data Bank**.

- **Validation**: `typecheck` 0 errors, `test` **406/406** (378 → 406: 20 on the
  deal arithmetic including the owner's own example both ways, and the
  compatibility mirrors; 14 on the field mapping), `build` compiles, `eslint
  src` at the 7 pre-existing errors and 34 warnings.

  **Driven in Chrome.** Deal Entry typed with 50 lakh / 10 lakh / 10 lakh:
  Remaining showed **4,000,000** and the strip read *"COMMISSION BASE —
  Total Price less the adjustment — Rs 4,000,000"*; clearing the adjustment
  moved both to 5,000,000 and the caption to *"The total price"*. The folder
  editor's picker was confirmed to offer Deal Entry / KYC / Lead groups and to
  exclude `deal:remaining` and `lead:phone`. **Nothing was submitted or saved** —
  no deal was closed and no folder mapping was written, since which column maps
  where is the owner's decision.

  **Not exercised end to end:** a promotion carrying mapped values onto a lead.
  That needs a folder mapping saved and a row promoted, both of which write to
  live data.

### 2026-09-05 (sixth round) — the phone status change, re-verified; the admin could not edit a manager

**Reported again:** pipeline status still will not change on the phone, and
*"admin should be able to change status or anything of employee and manager"*.

**The phone fix was re-tested end to end and it works in this build.** Not with
a synthetic event this time: signed in as an employee, on the phone layout, the
select was focused and a real `ArrowDown` keypress sent — the browser's own
`change` event. `2 FT2 GULF` went ACCEPTED → CONTACTED and **Firestore
confirmed the write**; `ArrowUp` put it back and Firestore confirmed that too.
So if it is still failing for the owner, it is not this code — the likely
answer is that the build they are on does not have the fix yet. Nothing in this
project has been deployed; every round so far is local only.

**The admin gap was real, and I made it last round.** The manager dossier was
built with **no Edit button**, deliberately — a manager is edited by the Manager
form, not the employee one, and I judged that offering the wrong form was worse
than offering none. That was wrong: it left an admin able to open a manager's
record and change *nothing* about them — not their name, not their team, not
Active/Inactive — without closing it and finding the small Edit on the card
behind. `ManagerFormModal` moved up to `DirectoryView` so both entry points can
reach it, and the dossier's Edit now picks the form from the subject. The phone
already did this correctly.

- **Validation**: `typecheck` 0 errors, `test` 378/378, `build` compiles,
  `eslint src` unchanged. The phone status change verified against Firestore
  both ways and the test lead left exactly as found.

  **Not verified in the browser:** the manager Edit button. The signed-in
  session rotated to an employee's mid-round, and a manager's dossier is
  admin-only. It typechecks and the phone path it mirrors was already working.

### 2026-09-05 (fifth round) — the report was right; the dossier was asking a different question

**Reported:** an employee's dossier on "Today" shows a couple of remarks and
follow-ups, Reports on "Today" shows a great many — *"make the report section
work properly… recheck every single thing."*

**Rechecked, against the raw database rather than the code.** Three candidate
causes were measured and all three ruled out:

- **Orphaned entries.** The collection-group path is unscoped, and a
  subcollection outlives a deleted parent, so it *could* count entries whose
  lead is gone — and that path only went live when the index was created hours
  earlier, which fitted the timing suspiciously well. Measured: **0 orphans**,
  58 entries, 58 live parents.
- **Missing `kind`.** 24 entries carry none, and the report counts anything not
  `REMARK` as a follow-up. Measured for the day in question: **0 entries
  without `kind`**, so nothing was miscounted.
- **Double counting.** Ruled out earlier in the day by the same method.

**The report is correct**, verified end to end: an independent count straight
out of Firestore gives Aroosa 5 remarks / 25 follow-ups, Sundus 22 / 1, Hussain
4 / 0 — and the screen shows exactly those numbers.

**What was actually wrong was the dossier.** Its period filter measured
`lead.createdAt`, so "Today" meant *leads created today*. The employee who had
logged 30 entries that day owned no lead created that day, so her record showed
**nothing**, next to a report showing 30. The original rationale — "filtering on
last touch would move a lead between periods every time it was rung" — is right
for the leads workspace, which answers "what came in this month", and wrong for
one person's record, where "Today" can only mean *what did they do today*.
`applyLeadFilters` now measures the last touch, `lastTouchAt` moved into
`directoryChrome` so the sort and the filter cannot disagree, and the count line
reads `30 / 41 worked`.

**They still do not produce the same number, and should not**: the dossier
counts leads, Reports counts entries. Both now say which — the chip hints name
the unit, and the report's footnote gives the 30-entries-across-5-leads example
outright, because that is the comparison somebody will make.

**Also fixed: the phone's Pipeline Status did nothing.** The handler was
`async () => setLeadStatus(await getIdToken(), lead.id, e.target.value)` — the
token is awaited *first*, and by the time it resolves React has re-rendered the
controlled select back to `lead.status`, so `e.target.value` read the **old**
status. The server saw a request for the status the lead already had, returned
without writing, and the dropdown snapped back: no error, no log line, a
dropdown that simply refused to move. The value is now read synchronously. The
desktop never had this because it passed the value in on the event. Recorded in
*Lessons*; a grep confirms it was the only occurrence.

- **Validation**: `typecheck` 0 errors, `test` 378/378, `build` compiles,
  `eslint src` at the 7 pre-existing errors and 34 warnings. Driven in Chrome:
  the report's per-person figures match an independent Firestore count exactly;
  Aroosa's dossier on Today went from empty to `30 / 41 worked`; the phone's
  status select moved Contacted → Details Sent and **stayed**.

  The status test was run on an obvious test record and **reverted immediately**
  — confirmed back at `CONTACTED` in Firestore, so the live data is as it was,
  minus two audit-trail lines.

  **Not changed:** the report's arithmetic. It was measured to be right, and
  changing something that is correct because it disagrees with something that is
  not is how the wrong screen wins.

### 2026-09-05 (fourth round) — a manager's own Data Bank, and two lead-pane bugs found by looking

**1 · A manager could not create a folder, so their Data Bank was empty.**
`createDataBankFolder` / `update` / `delete` were `requireAdmin` while
`addDataBankRecord` and `importDataBankRows` were already `requireManager` —
so a manager could fill a folder they had been handed and never make one. All
three are now `requireManager`, with the owner taken from the **token** for a
manager (they cannot file a folder under somebody else) and the owner field
ignored outright on update (they cannot give one away). `assertFolderAccess`,
the predicate every record write already used, guards edit and delete.

The screen followed: New Folder, Edit fields and Delete are `isManager` on both
the desktop grid and `MobileDataBank`, the owner select in `FolderFormModal` is
admin-only, and the folder card's link and the workspace's Back button are now
role-aware — both hardcoded `/admin/data-bank`, which happened to render for a
manager because the route allows both roles, and then read as the admin's URL
space from there on.

**"New Folder" removed from Clients**, as asked. A Client folder holds leads
that already exist, so a hand-made empty one has no way to be filled; every
route in is a promotion from the Data Bank. Rename and delete stay.

**2 · Two real bugs in the lead pane, both found by opening a lead rather than
by reading the code.** Four hypotheses were tested against the live project
first and all four were wrong — no leads stuck at ASSIGNED, no stale
`latestFollowUpId`, no entries missing `occurredAt` (which `orderBy` would have
hidden), no editable entry failing revalidation. Then the screen showed it:

- **The entry numbering ran backwards and lost one.** `followUps.length - index - 1`
  over the *chronological* array numbered five entries #4, #3, #2, #1 and then
  nothing — and the unnumbered one was the only one with an Edit button, so the
  entry a reader would call "the last remark" was the one showing a padlock.
  Now: the Remark is named, and each Follow-Up after it is `#{index}`.
- **The status dropdown offered "Deal Closed", which `setLeadStatus` always
  refuses** — a won deal must go through Deal Entry so the customer and the
  amounts are captured. Choosing it produced an error and the status did not
  move, which is exactly "the status will not change". Filtered out of both
  surfaces' P1 group.

**3 · Found while there, and worse than either:** `updateFollowUp`'s
immutability lock was `if (lead.latestFollowUpId && …)`. Six live leads have
entries but no pointer, and on those the guard evaluated false — **every entry
in the history was editable**, by any role, through the action. The fallback now
resolves the newest from the subcollection by `occurredAt`, matching what the
pane shows, and writes the pointer back so the lead is repaired on first edit.

- **Validation**: `typecheck` 0 errors, `test` 378/378, `build` compiles,
  `eslint src` at the 7 pre-existing errors and 34 warnings. Verified in Chrome
  as the admin: numbering now reads #1–#4 with Edit on #4, the status select no
  longer contains `CLOSED_WON`, Clients shows only "Import from Data Bank", and
  the admin Data Bank is unchanged.

  **Not verified as a sub admin** — the browser session is the admin's. The
  gating is symmetric (`isManager` on both surfaces) and the server re-checks
  every path, but the manager's own create/import/add flow is worth one pass
  before relying on it.

  **Left alone:** no lead is currently stuck at ASSIGNED, but `vercel.json`
  schedules `process-deadlines` **once a day** (`0 0 * * *`) against a
  **5-minute** accept window, and `CRON_SECRET` is still empty so the route
  refuses to run at all. A lead whose employee never accepts will sit there.
  That is a deployment matter, not a code one, and was not touched this round.

### 2026-09-05 (later still) — GPS, because a saved Wi-Fi name goes home in a pocket

The owner asked the right question about the morning's work: *"what if the
person saves the name of wifi and then checks in from home?"* It works. The
Wi-Fi name is text on a phone; it does not know where the phone is. Wi-Fi alone
only ever stopped the lazy case.

**The browser will give up a position, and that is the check that answers it.**
`navigator.geolocation` against the office's marked coordinates, compared
server-side. Someone at home is four kilometres away and is refused no matter
what they typed. It is not unfakeable — a mock-location app defeats it — but
that is deliberate technical effort, where reusing a saved name is zero effort.
That gap is the entire value.

Rules that took the most thought, all in **Business rules → Attendance**:

- **The error bar is never subtracted from the distance.** `distance - accuracy
  <= radius` is the obvious-looking version and it silently turns a 150m rule
  into a 400m one the admin cannot see. Accuracy does one job: readings vaguer
  than 200m are `IMPRECISE` and retry, never `AWAY`. A laptop on Wi-Fi
  positioning is often a kilometre out and must not be called a liar for it.
- **The office is marked by standing in it and pressing a button.** No latitude
  box. Somebody typing coordinates gets them transposed, and a wrong office
  refuses the whole company — with the person who set it wrong the only one who
  can fix it. Settings also refuses to pin the office from a vague reading.
- **Location wins over the Wi-Fi name** wherever it has an answer
  (`resolveNetwork`), and the name is the fallback for a device that will not
  share a position.
- **The prompt appears only on Check In**, and `PunchRulesHint` explains it
  before the browser asks. An unexplained permission prompt is one people
  decline, and a declined prompt is an employee who cannot check in at all.
- **A failed fix is sent to the server, not swallowed.** The refusal is the
  server's to make and to record; handling it in the browser would lose the
  audit entry.

`lib/geolocation.ts` wraps `getCurrentPosition` because every failure needs its
own sentence — "location is blocked for this site, tap the padlock" is
actionable, "could not get your location" is a support ticket. It also carries a
belt-and-braces timeout: `getCurrentPosition` has been seen never to call back
at all on some Android WebViews.

- **Validation**: `typecheck` 0 errors, `test` **378/378** (360 → 378: haversine
  against hand-checkable figures, the IMPRECISE cases, and the proof that the
  error bar is not subtracted), `build` compiles, `eslint src` at the 7
  pre-existing errors and 34 warnings.

  **Driven in Chrome with `getCurrentPosition` stubbed**, which avoids a
  permission prompt and makes both paths deterministic: a precise fix marks the
  office and reports its accuracy; a 2km fix is refused with the reason and
  **leaves the previous coordinates untouched**. Confirmed afterwards that
  nothing reached the live config — the office still reads "Not marked yet".

  **Not exercised against the live project:** a refused check-in. Doing so means
  switching the restriction on during a working day, and every device that has
  not yet granted location is refused until somebody taps Allow. The owner marks
  the office and turns it on at the start of a day, having told the team first.

### 2026-09-05 (later) — the IP check is gone; Wi-Fi is the whole gate

The owner's call, and the right one: *"remove the ip system as it changes
dynamically so i cant match it."* Half-measures were tried in the morning —
CIDR ranges, two restrictions that both had to pass — and they were still
maintenance on a value that rotates without warning.

**Removed entirely.** `ipRestriction` and `officeIps` are gone from
`AttendancePolicy`; `classifyNetwork`, `ipMatchesEntry`, `isValidIp`,
`isValidIpOrRange` and `resolveNetwork` are gone from `lib/attendance`, with
`networkFromWifi` in their place. The office-network card is gone from
Attendance Settings and the IP editor from `/admin/settings`, which now says in
one paragraph where the setting went and why. `normalizeIp` and
`clientIpFromHeaders` stay: **the address is still recorded on every punch**,
because it costs nothing and it is the thing an admin checks a suspicious day
against. It is simply never compared to anything.

Stale `officeIps` / `ipRestriction` values are left sitting in
`config/attendance` untouched. `normalizePolicy` does not return them, so
nothing can read them — and a migration that deletes configuration is a
migration that can go wrong for no gain. A test asserts they do not survive
`normalizePolicy`.

**Three things make the declared signal worth having**, and they are the
difference between this and security theatre:

1. **The refusal message never names the office network.** It was the one place
   the expected answer could leak, and the morning's version printed it — so
   the first person who guessed wrong was told the right answer. It now names
   only what *their* device claimed.
2. **Every refusal is recorded and notified.** `recordRefusedCheckIn` writes
   `users/{uid}.lastRefusedCheckIn` and notifies the admin, HR and the
   employee's own manager, throttled to the first refusal per person per day.
   Deliberately **not** written to `attendance/{uid}_{dayKey}`: that document
   with no `firstActionAt` reads as an opened day, and `deriveStatus` grades a
   day with no activity as absent — a refused attempt must not mark anybody
   absent.
3. **The requirement is re-asked after a refusal.** `getPunchRequirements` is
   read once at mount, so a browser open since before the admin switched the
   rule on would be refused and told to use a box that was not on its screen.
   A failed punch now re-asks and the field appears.

**Found while removing it:** the deletion anchor for `resolveNetwork` ran to
`ATTENDANCE_STATUS_LABELS`, which took `workedMinutes`, `formatWorkedHours`,
`formatClock` and `deriveStatus` with it. Typecheck caught it immediately and
they were restored from `git show HEAD`. Worth remembering that a
delete-between-two-anchors patch is only as safe as the *nearest* anchor.

- **Validation**: `typecheck` 0 errors, `test` **360/360** (380 → 360: the
  IP-matching suites went with the mechanism, replaced by the Wi-Fi predicate
  and a test that the retired fields do not survive `normalizePolicy`), `build`
  compiles, `eslint src` back at the 7 pre-existing errors and 34 warnings.
  Attendance Settings and the punch strip driven in Chrome.

  **Live effect, immediately:** with `officeIps` no longer read, the stale
  `ipRestriction: true` in `config/attendance` stopped blocking anybody —
  check-in works for the whole company again as of this change, with no gate
  until the office Wi-Fi names are filled in.

  **Not exercised end to end:** a refused check-in was not triggered against the
  live project, because doing so means switching the restriction on during a
  working day and every device that has not yet been told the network name is
  refused until somebody types it. Turn it on at the start of a day, and tell
  the team first.

  **Superseded within the hour:** the owner asked what stops somebody saving the
  network name and checking in from home. Nothing did. See the entry above —
  the position check is the answer, and this one became the second opinion.

### 2026-09-05 — Clients is workable for a manager, Wi-Fi check-in, the manager dossier, Reports rebuilt

Four reports, all confirmed against the running app rather than reasoned about.

**1 · A manager could open a lead in Clients and not write on it.** Both panes
computed `isManagerView = userRole === "subadmin"` and hid the Remark, the
follow-up, the edit and the deal form. The server never refused any of it —
`canWorkLead` accepts a sub admin on a lead whose `subAdminUid` is theirs, and
the follow-up transaction credits `lead.assignedUserId`, which for a Client
promotion *is* the manager. The predicate now excludes the case it was never
meant to cover: `userRole === "subadmin" && lead.assignedUserId !== user?.uid`.
Desktop and phone, one line each.

**2 · Check-in by Wi-Fi name, and the real reason IP stopped working.** Read
live: `config/attendance` had `ipRestriction: true` with two **exact** addresses
(`119.73.100.106`, `154.192.107.175`). Those are dynamic ISP leases — the day
they rotate, the restriction refuses everybody, which is what happened.

Two fixes, because they answer different halves of it:

- **`officeWifiNames` + `wifiRestriction`**, what the owner asked for. The
  honest limit is stated on the settings card and in `lib/attendance`'s module
  note: **no browser exposes the SSID**, so the name is typed once per device
  and checked on the server. It catches somebody checking in from home out of
  habit; it does not survive somebody who decides to type the office network's
  name. It is worth exactly what the punch time beside it is worth.
- ~~**CIDR ranges in `officeIps`**~~ — built, then **removed the same day** at
  the owner's instruction; see the entry above. A range still needs somebody to
  know which block their ISP leases from and to notice when that changes, which
  is the maintenance the whole complaint was about.

The Wi-Fi check runs **first** when both fail, because "you are on `Cafe-Guest`,
not the office Wi-Fi" is a sentence somebody can act on and an IP address is
not. Check-out is still never refused. `resolveNetwork` lets either signal
stamp a day OFFICE, while a check-in must satisfy every restriction switched on.
22 new unit tests over the arithmetic that silently corrupts: /32 masking, an
IPv6 client against an IPv4 range, an unconfigured list reading UNKNOWN rather
than OTHER.

**3 · The admin could open any employee and no manager.** `selectedUid` was
resolved against `metrics` only, and the roster query is `role == "employee"`,
so a manager could never be found. Now resolved against both rosters, and
`EmployeeDetailModal` takes an optional `team`: present, it is a manager's
dossier — team-scoped leads, deals, activity and analytics, plus a Team tab
whose rows open that employee's own dossier. Same on the phone. Edit is absent
on a manager's dossier rather than opening the wrong form; the card keeps its
own, and both call sites `stopPropagation` so Edit does not also open the sheet
behind it.

**Found by looking at it:** the card behind said 70 leads and the dossier 78.
`buildManagerMetrics` summed the team and not the manager, and a manager *does*
hold leads now — a Client-section promotion is assigned to them. It now sums the
manager and their team, which is the set `reportScope.teamOf` already used, so
card, dossier and report finally agree. `headcount` stays the team size: how
many people report to you is a different question from whose work is in the
total.

**4 · Reports rebuilt round the question it is opened for.** The gradient hero,
six 252px stat cards and a separate pipeline panel were three screens of chrome
before the first name. Now: a one-line header, a controls bar, **one** totals
strip and the table, which starts above the fold. Added **Remarks** and
**Follow-ups** — every entry, connected or not, which is what "what did this
person do today" actually asks. Columns are grouped *Activity in range* /
*Outcome in range* / *Pipeline today*, the last tinted apart because it is the
one group that is not range-scoped. **A row opens that person's own report**,
so drilling in is one click; only rows the server offered as subjects are
clickable, so a click can never produce "you cannot see that".

**A discrepancy that was not a bug.** Aroosa's follow-ups read 53 in the team
view and 54 in her own. Probed with a throwaway script replaying both scopes:
83 entries either way, zero in one and not the other — the number was simply
climbing (53 → 54 → 55 over three minutes) because the team was working. Worth
recording because the instinct was to go looking for a scoping bug.

- **Validation**: `typecheck` 0 errors, `test` **380/380** (356 → 380), `build`
  compiles all 70 pages, `eslint src` at the 7 pre-existing errors and 34
  warnings. Reports, the directory, the manager dossier and Attendance Settings
  driven in Chrome against the live project.

  **Not driven**: the sub-admin Clients fix was verified from the server rules
  and both call sites, not clicked — the browser session was the admin's. Worth
  one pass as a manager before relying on it.

  **Superseded the same day:** the two stale exact IPs no longer matter, because
  nothing reads `officeIps` any more. What is owed instead is the office Wi-Fi
  name — see the entry above.

  **Indexes: done later the same day.** See *Operational state* — the IAM role
  was granted, `deploy:indexes` created 13 indexes and the `followUps.dayKey`
  override, and Reports now runs the collection-group query (~750ms) rather than
  the per-lead fallback. Its warning banner is gone.

Entries before 2026-08-31 were folded into the rules and *Lessons* above on 2026-09-04;
the full history is in git.

### 2026-08-31 — Employee Directory rebuilt from both design files

Transcribed from `Employee Directory[ Mobile].dc.html`, not measured. New
`directoryChrome.tsx` (`E` tokens, `HeroRings`, `Card`, `Bar`, `buildDirectoryStats`,
`buildDirectoryAnalytics`), `AnalyticsPanels.tsx` (one implementation, two sizes),
`EmployeeFormModal.tsx` (New and Edit as one component), `MobileEmployees.tsx`.
`AddEmployeeModal.tsx` and `employeeChrome.tsx` deleted.

- **Ring geometry is transcribed per file, not generalised** — deriving it as a fraction
  of the viewBox made the phone rings 28% too large. `RING_SETS` holds all three verbatim.
- The design's hard-coded sparklines were replaced with seven real monthly readings.
- Three fields the design does not draw were added because the feature fails without
  them: password (Auth cannot create a user without one; blank on edit keeps the
  current), lane priority, monthly KPI targets.
- Status saves through `disableEmployee`/`enableEmployee`, which report how many open
  leads the employee was holding.
- The phone's add/edit sheet carries **every** desktop field. An admin on a phone must be
  able to create a usable account, not a half-configured one.

### 2026-08-31 — Add Lead parity on the phone, account sheet, dossier filters, pagination

- The phone's Add Lead went from 8 fields to the desktop's 21 — full 12-status list, the
  whole settlement block, backdated history notes — with the desktop's validation rules
  in the desktop's order with the desktop's messages.
- `MobileAccount.tsx`: the phone had no way to sign out. Sign-out `replace()`s so a back
  gesture cannot land on a signed-in screen from the bfcache.
- Dossier filters call `matchesLeadFilter` rather than restating what "active" means.
  Period is measured on `createdAt` for leads and the settlement date for deals —
  filtering leads on last touch would move a lead between periods every time it was rung.
- `usePagination` + `Pager`. Page sizes 10 (roster) / 15 (leads) / 8 / 12 (phone) / 6
  (dossier tabs). Deliberately **not** a Firestore cursor: these lists are already loaded
  for their rollups, so a cursor would fetch twice and make the totals disagree.

### 2026-09-01 — The Data Bank

Cold lists, per-source fields, CSV import, cursor paging, promotion. Rules and rationale
are in **Business rules → Data Bank**; 38 tests over the parts that silently corrupt
data. No CSV dependency (SheetJS 0.18.5 carries two unpatched advisories and the patched
build is off-registry).

`suggestColumnMap` matches word by word after expanding abbreviations, because the
motivating example fails prefix matching: **`No` is not a prefix of `Number`.** There is a
small explicit table (`no/num → number`, `addr`, `amt`, `qty`, `ph`, `mob`).

### 2026-09-01 — Manual lead entry moves to the Data Bank

Signed off. Add Lead removed from `/admin/leads` (replaced by a link to the Data Bank);
the phone's centre button became the call action for both roles. "Leads is Meta Ads only"
cannot be literal — a promoted record has to appear in the pipeline, and does. What it
meant was *no manual seeding*, which is what shipped.

### 2026-09-01 — `purge-all-data`

See **Operational state**. Two gates rather than one because a flag is easy to copy out
of a README into the wrong terminal and a project id is not; everything is counted before
anything is deleted so the prompt can say "deletes 4,182 documents". `recursiveDelete`,
or `leads/*/events` and `leads/*/followUps` survive their parent, unreachable and still
billing. Validated against the emulators — 23 assertions on the resulting database, not
on the script's own output.

### 2026-09-01 — Data Bank UI parity, 40k imports, a real phone screen

- The folder workspace is now the leads workspace: same shell height, teal band, search
  row, chip geometry, `grid-cols-[44px_1fr_auto]` rows, staggered entrance and read-state
  shading from the same `useOpenedLeads`. `WorkspaceEmpty.tsx` is shared so both render
  literally the same SVG.
- Header folder names **wrap to two lines rather than truncate** — "ALL LEADS" always
  fits; a folder name is the one thing on that bar that must be readable.
- `MAX_IMPORT_ROWS` 20,000 → 200,000, and the real bug fixed: payload-size chunking. A
  **Reading…** step, because parsing 40,000 rows on the main thread otherwise just looks
  frozen; a remaining-time estimate withheld until a tenth of the file is through, so the
  first chunk's connection setup does not produce a wild figure that then collapses.
- `MobileDataBank.tsx` — a real phone screen, not the two-pane grid at 390px. Reads are
  gated on which surface is rendering; letting both subscribe would double the cost of
  the one list that costs a page of reads to open.
- The admin's phone centre slot became the Data Bank on every screen (a destination, not
  a contextual action). Cost, stated: the admin loses the contextual call button.
- **Proven with a real 40,000-row × 4-column CSV (5.4 MB):** parsed in 0.4s, all four
  columns auto-mapped including `Contact No`, 40,000/40,000 imported, 80 chunks at 104 KB.

### 2026-09-01 — Promotion latency; attendance becomes a manual punch

Ran the real code path against the emulators rather than reading it. **The pipeline was
never broken** — the write committed every time. Two things made it look otherwise:

1. **The success banner was rendered inside the component being destroyed.** `onRemoved`
   unmounts `RecordPane` in the same tick. The banner moved to the always-mounted list
   panel and carries a link into the pipeline.
2. **Seven sequential round trips.** Three reads parallelised, a duplicate folder read
   removed, and `runTransaction` replaced with a `WriteBatch` — nothing was read in the
   critical section, so it was paying for guarantees it never used. Seven → three.

Attendance became a manual punch (the heartbeat removed). The trade is stated: presence
is now declared. What did not change is that the network is still classified server-side.

### 2026-09-01 — Admin punch buttons; `checkRevoked` dropped

Two corrections. I had hidden the punch buttons from admins on my own reasoning that an
admin is not on the roster's clock — the owner *is* the admin and had just asked for the
button. **Removing a requested feature for a role on my own judgement was the wrong
call.** And `checkRevoked` was removed from token verification (see *Lessons*).

### 2026-09-01 — Promotion stops waiting on the response

Fourth report of the same symptom; the decisive evidence was a screenshot showing the
folder count had *dropped*. The write was committing and the browser was still waiting.
`lib/watchGone.ts` races the realtime channel against the HTTP response. Proven by
intercepting the Server Action POST, letting it commit, then holding the response back
for 40s: the button released in 0.6s reporting success.

### 2026-09-01 — The real root cause: the daily Firestore quota

Fifth report, answered by the console's usage page: **writes 20,000/20,000, deletes
20,000/20,000**. Every observed detail follows from that and nothing else — including
"sometimes it works", which is a per-day budget being spent in real time. The 40,000-row
import built that same morning is what spent it; the 20,000-row cap it replaced had been
holding the project inside the free tier by accident.

The four earlier fixes each addressed something genuinely wrong, and **none of them could
have fixed a database refusing writes.** What the code owed the owner was to *say* that
instead of blaming the network a fifth time — hence `lib/quotaError.ts`, and an import
modal that warns before the button is pressed.

### 2026-09-01 — What an import costs, counted honestly

40,000 rows = 40,000 record writes + 80 counter writes + ~1,360 reads (**3%**; the
duplicate check is already batched 30 numbers per query, and a duplicate row costs a read
instead of a write, so re-importing an overlapping sheet is nearly free). **The writes are
a floor, not a setting** — one record is one document. `estimateImportCost()` shows
writes, reads and Blaze dollars in the modal above 1,000 rows.

The only real lever is a different data model (~200 records per bucket document: 200×
fewer writes, 8× fewer list reads, at the cost of server-side search and status filtering
plus write contention). That is a rewrite of the storage layer and is the owner's call.

### 2026-09-02 — The delete quota, and why gRPC hid it

Measured against the live project: `set` 1.8s, **`delete` still retrying at 170s over
gRPC but refused as a 429 in 293ms over REST.** Promotion now moves the row instead of
deleting it inside the batch, and `preferRest` defaults on. See *Lessons*.

### 2026-09-02 — Hierarchy, KYC, Pipeline Stage, profit distribution

Twenty-seven requirements as one workflow; all of it is in **Business rules**. Worth
restating: the sub-admin link lives on the subordinate because rules cannot prove a list
query against a scope in another document; `dataBankRecords` are scoped by a `get()` on
their folder rather than a denormalised field, because a folder can hold 40,000 rows and
reassigning one must not mean 40,000 writes (rules cache identical `get()`s within an
evaluation, and a page comes from one folder).

Deliberate omissions: a sub admin's team's *attendance* (the rows carry no team field, so
a rule would cost a lookup per day per employee) and write access on the team dossier
(the actions refuse it, and offering buttons that error is worse than not offering them).

### 2026-09-02 — Corrections round: KYC fields, Remark, Manager, redesigns

Seven changes. KYC gained the commercial half and **`required` is gone from the field type
entirely**, so no surface can mark a field mandatory. The Remark rule shipped. "Auto" was
removed from the stage control — it was never a stage, it is the *absence* of a pin;
pressing the lit stage clears the pin, and a pinned stage carries a dot. The Manager form
split off from Add Employee. `lib/managerMetrics.ts` added, kept out of `metrics.ts`
because that module imports `./dates` (see *Lessons*). Profit Distribution rebuilt in the
newer form language with **the arithmetic untouched**.

### 2026-09-02 — The half-window bug, mobile parity, and Money

Root-caused `will-change: transform` breaking `position: fixed` (see *Lessons*).
`components/ui/OverlayPanel.tsx` is both the fix and the guard; Closed Deal, Profit
Distribution, Add Manager and the Data Bank delete confirmation were rebuilt on it, and an
audit shows every `fixed` overlay in `src` now portals.

Money replaced Reports in the phone's bottom bar — one of five slots should open the whole
money side, not one screen. `MoneyHub` is role-scoped and every card links to a page that
already exists. The phone Team screen gained the People/Managers switch and `Reports To`,
which had been editable on one surface only.

### 2026-09-02 — Sub admin folder read; mobile Team add buttons

`FolderWorkspace` still computed `wantsData = isAdmin && !isMobile`, so a sub admin
subscribed to nothing and the screen reported an assigned folder as missing. Fixed to
`isManager`. The message is also split in two — a folder that is gone and one never
assigned to you are different problems, and reporting the second as the first sent people
looking for deleted data.

Mobile Team's add control was published through `useMobileCentre`, but an admin's centre
is pinned to the Data Bank, so the request was silently discarded. It is now a header
button *and* a named button above the list, which is better anyway: visible while the list
is, and it says what it adds.

### 2026-09-02 — Status bands, editable entries, Cold review, Reports, Clients

Twenty-one items; the rules are above. The two that changed everything else: **Pipeline
Status now decides Pipeline Stage** (removing a reachable contradiction — a lead marked
Negotiation *and* pinned Cold, both displayed as true), and **Cold became a decision**.

Bulk assignment takes 25/50/75/100 from the top of what is on screen, in the order shown,
and says so when the filter holds fewer. Neither bulk path copies a lead — "the employee
receives those exact leads" is satisfied by there being one record.

### 2026-09-03 — The Attendance module

Built on the existing employee, manager, notification, auth and money structures: no
second roster, no second notification system, no second idea of who manages whom. Rules in
**Business rules → Attendance**. `lib/attendancePolicy.ts`, `lib/attendanceCalendar.ts`
(pure and tested — three screens needed a month's bounds and each could have got December
wrong on its own), `app/actions/{attendance,leave}.ts`, `components/attendance/`, 17
routes.

Settings restates each rule as a sentence — "a check-in at or before 09:15 is on time" —
because a parameter list nobody can read is one nobody dares change.

**Found while building:** the demo seed called `now()`, a `const` declared *after*
`seed()` runs — a temporal dead zone error that only appears in a production build, where
the seed is evaluated during prerender.

### 2026-09-03 — Salary / Payroll and Office Expenses

Every figure is owned elsewhere and read, never recomputed: basic salary from
`users/{uid}.monthlySalary` (the same field attendance uses), commission from
`dealPayouts`, the deduction from `attendancePeriods` if the month is closed and only
calculated fresh if it is open. Rules in **Business rules → Money**.

**Deliberately not built:** salary revision *scheduling*. It needs an effective-date model,
and guessing at one would put a date on every payslip nobody asked for.

### 2026-09-03 — Chronological history, three-way assignment, Clients from the Data Bank

Eleven changes. History reads in the order it happened. The Data Bank assigns to Employee,
Manager or Admin/Myself via one grouped `lib/assignTargets` list (paused accounts are never
offered — the server refuses them, and a choice that will be refused is worse than none).
Clients imports by calling the same `promoteDataBankRecords` the Data Bank's own bulk bar
calls, so nothing is duplicated.

**Reports:** Connect and Follow-Up Connect made disjoint, and the stage query batched
30 at a time on `assignedUserId in […]` instead of one round trip per employee.
**Salary performance:** `SalaryProfilesPanel` read the whole `users` collection on mount
and unmounts on every tab change; the state moved to `useSalaryProfiles` in the parent.
The admin's duplicate "My Salary" nav item was removed — but a **Sales manager keeps it**,
since for them it is the only route to their own payslips.

### 2026-09-03 — Clients is the Data Bank screen; a Client folder is the leads screen

Both reports were "the UI is not the one I asked for". A Client folder now **is**
`LeadsWorkspace`, given a `LeadScope` of the folder's lead ids — not a copy, so the list,
chips, search, pagination, row shading, `LeadDetailPane` and every action are identical
because there is one implementation. The scope is applied **before** search, so chip counts
describe the folder, and the selected lead resolves against the scope, so closing a deal
inside a folder keeps the pane open. `MobileClients` imports its primitives from
`MobileDataBank` rather than restating them.

### 2026-09-03 — Reports: the error found by measurement

Probed the live project rather than reasoning. The failure is **HTTP 400** with
`"requires a COLLECTION_GROUP_ASC index"` — my previous guard tested for gRPC 9
`failed-precondition` and the wording "requires an index", so it caught neither.

Fixed twice over: detection now matches the message shape *and* the codes, and **the
report no longer fails at all** — it falls back to per-lead subcollection queries in
parallel batches of 25, with a `warning` saying it ran the slow way. The screen was
rebuilt in the directory's language, since the two sit beside each other in the sidebar
and describe the same people. A zero renders in `E.hair`, so a row of real work stands out
from a row of nothing.

### 2026-09-03 — Attendance: IP on check-in only, one punch control, the Team language

Check In and Check Out are not symmetric acts; four unit tests pin the asymmetry because
it is exactly the kind of rule that gets "simplified" back into a bug. Exactly one punch
control per role, `canPunch` defaulting to **false**; where it is absent the screen says
where it lives, so its absence is an answer rather than a gap.

**The sidebar scroll** moved off the `<aside>` onto the nav area with `min-h-0`. The
collapsed rail keeps `overflow-visible` because its flyout must escape the 96px rail.
Sidebar search removed at the owner's request. The phone account sheet became two levels
mirroring the sidebar's accordions, with single-destination sections flattened.

### 2026-09-03 — The tab strip was underneath the hero

The attendance dashboard cancelled `<main>`'s padding with `margin: -24px -28px`, pulling
itself up **over the tab strip the layout renders above it**. The strip was never missing.
`AttendanceShell` now owns the bleed, the ground, the padding and the strip, so a page
renders in normal flow and cannot climb over its own navigation.

The calendar was rebuilt aliased onto `directoryChrome`'s tokens rather than restating
them. **Today is ringed, not filled** — a fill needs a fifth colour competing with the four
that carry meaning. The legend carries the month's counts, so it answers the question
somebody actually has instead of being a key they must translate.

### 2026-09-03 — The collapsed rail's flyout ran off the bottom

Attendance is the first menu long enough to expose it (seven entries; every other fits in
four). Fixed by measuring — see *Lessons*.

### 2026-09-03 — Check-in was accepted off the office network

Read the live config rather than guessing: `config/attendance` had `officeIps` populated
and **no `ipRestriction` field at all**, so `normalizePolicy` filled it from the default
(`false`) and correct enforcement simply never ran. Fixed at the source of the default —
an absent flag with addresses configured now reads as **on**. Somebody typing their office
IP into Settings means "only let people in from here"; there is nothing else it can mean.

### 2026-09-04 — Reports rebuilt round a subject, records handed to managers, P3 starts at the Remark

Four areas, and two of them changed a rule the rest of the app reads.

**1 · Accepting a lead is no longer progress on it (§3).** `ACCEPTED` sits in the
P3 band, so every lead inflated the pipeline the moment it was handed out.
`awaitingFirstEntry` in `pipelineStage.ts` now holds a lead at **no stage at
all** until its first entry exists; writing the Remark makes it P3. Every other
P3 status is a person saying they did the work ("Contacted", "Following up"), so
those still take the band immediately.

Derived from `followUpCount`, which is already on every lead — so leads that
exist today classify correctly the moment this ships, there is no backfill to
run, and the answer survives a reload because nothing is stored. The chips, the
counts, the dossier and the report all read `pipelineStage`, so they moved
together; the **report used to read `stageForStatus` directly** and now does
not, which is what made its P-columns disagree with the rest of the app.

Both detail panes say so rather than showing an empty row: *"Not started — add
the first Remark to reach P3."* A rule the user cannot see is a rule they will
not trust.

**2 · Team → Reports has a subject, not a search box.** A search filters a list
you are already looking at; this picks *what the report is about*. The grouped
selector offers **All Employees · All Managers · each employee · each manager ·
the admin**, and the server returns the options rather than the client guessing
them, so the selector cannot offer a subject the server would refuse.

**No double-counting is a property of the sets, not care at each call site.**
`lib/reportScope.ts` builds every figure per person, once, and a composite
subject is the sum of a *set of people*: a manager's row is themselves plus
their own employees, All Managers is every manager's set concatenated with a
`seen` guard, and an employee belongs to exactly one manager. 26 tests, including
the moved-employee case and the arithmetic spelled out.

An employee under no manager is in All Employees and on their own row, and
deliberately absent from All Managers — inventing a "no manager" bucket there
would read as a team that does not exist. **All Managers is only offered when
there are two or more**; with one manager it and that manager produce identical
figures, and two options that do the same thing read as though they do not.

Columns are the ones asked for — ID, Name, Team, **Remarks, Follow-ups**, New
Connects, Follow-up Connects, Meetings Done, Site Visits Done, Deals Closed,
Tokens Received, P1, P2, P3 — grouped under *Activity in range*, *Outcome in
range* and *Pipeline today*, and every one computed from records that already
exist:

| column | read from |
|---|---|
| Remarks | first entries written on a lead in the range |
| Follow-ups | every later entry written in the range |
| New Connects | connected calls logged on a **Remark** |
| Follow-up Connects | connected calls logged on a **Follow-up** |
| Deals Closed | `closedDeals` settled in the range |
| Tokens Received | leads whose token money arrived in the range |
| P1 / P2 / P3 | where their leads stand **now**, via `pipelineStage` |

**Tokens needed a new field.** A lead that took token money moves on to Deal
Closed, so the current status no longer says the token happened;
`tokenReceivedAt` is stamped one-way the first time the status reaches
TOKEN_RECEIVED, the same pattern `meetingHeld` follows. Leads recorded before
the field existed are counted from their current status, so history does not
read as zero.

The activity columns are range-scoped and the P-bands are not — a stage is a
property of a status *today*, and back-dating it would need an event replay this
report does not pretend to do. The screen says so instead of implying otherwise.

**ID** is derived from the uid (`shortId`), not stored: stable across reloads,
readable aloud, and no migration. The full uid is on the row.

**3 · A manager is handed records, not leads (§2).** Assigning a Data Bank row
to an employee promotes it; assigning it to a **manager** now moves the row into
that manager's own Data Bank, in a mirror of the source folder
(`assignRecordsToManager`, deterministic id `mgr_{uid}_{sourceFolderId}`). The
manager then distributes it to one of their team — or takes it themselves, at
which point it becomes a lead in their Client section by the path that already
existed.

- **The rows move, they do not copy.** Two documents for one prospective client
  means the admin and the manager can each promote their own and two people ring
  the same number. Moving keeps one row for one owner, which is the rule
  promotion already follows. The admin still sees them: an admin reads every
  folder, the mirror is badged *"Handed to {manager}"* in the grid, and the
  source folder shows a **Handed on** count.
- **Only the named manager.** The mirror carries their uid and nothing else's,
  so Manager B cannot reach it — their folder query is
  `where('subAdminUid','==',them)` and the existing rule enforces exactly that
  clause. No rules change was needed.
- The mirror carries the source's **fields, keys and roles verbatim**. Records
  are stored against field keys, so a mirror with its own keys would render every
  handed-over row blank.
- A lead promoted out of a mirror is filed under the **original** folder's Client
  mirror (`sourceFolderId`), or one source fragments into a Client folder per
  route it took.
- Handing sideways is the **admin's** call — `requireAdmin`, and a manager's own
  assign list never loads the management layer.

**The reason the Managers group never appeared** was not a missing feature:
`buildAssignOptions` has supported managers since it was written, but both Data
Bank surfaces fed it `useEmployees`, which queries `role == "employee"`. The
group was therefore always empty. Both now merge `useSubAdmins`, and the option
carries an `action` (`PROMOTE` / `HANDOFF`) so the row action, the bulk bar and
the phone sheet cannot dispatch differently.

**4 · Three more cuts in the employee dossier.** Remarks, Follow-ups and
Connected, on both surfaces, from the counters the follow-up transaction already
maintains. **The two entry thresholds differ by exactly one** — the first entry
on a lead is its Remark, so one entry is remarked and two is followed-up. They
sit after the stages and share one tone: they answer *what has this person
done*, not *where does this lead stand*, and giving each its own colour would
read as three more stages. Not added to the workspace chip row, and not
accepted as a `?filter=` value.

**Mobile parity, which was the reported bug.** On the desktop dossier a lead row
has always opened `LeadDetailPane`; on the phone the same card was **inert**, so
a manager could see that a lead existed and could not read a word of it. It now
opens `MobileLeadDetail` — the same document, the same actions — resolved
against the live list so a change made inside the sheet is reflected behind it,
and Escape closes the lead before the profile.

Three more gaps closed in the same sweep:
- The phone's Data Bank had **no bulk selection at all**. It now renders the
  desktop's `BulkPromoteBar` in its `compact` form — one implementation, so the
  quantities and the recipients cannot differ. The avatar doubles as the tick
  target: a separate checkbox column costs 28px of a 390px row and pushes the
  phone number off the end, and a ticked row takes the deepest read-state tone.
- **Priority Settings** is linked from the phone account sheet and rendered a
  four-column table with two controls per row. Cards below 820px, carrying both
  controls.
- The bulk bar's recipient select is 16px on the phone, or iOS Safari zooms the
  page on focus.

**Left alone, deliberately:** the seven `admin/accounts/*` ledgers and Campaigns
are still tables on the phone. They are inside `ResponsiveTableWrapper`, so they
scroll in their own container and the page never scrolls sideways — usable, not
beautiful, and outside the four areas this round was about. `assignLeadsBulk`
still has no UI on **either** surface, which is a missing feature rather than a
parity gap.

- **Validation**: `typecheck` 0 errors, `test` **346/346** (306 → 346: 26 on
  report scoping and the no-double-counting arithmetic, 13 on the activity cuts
  and the accepted-lead band, plus the hand-off action), `build` compiles all 70
  pages, `eslint src` back at the 7 pre-existing errors and 34 warnings. Nine
  routes smoke-tested against the running dev server (200 each).

  **Not driven in a browser** — no automation is available in this session, and
  this machine has neither Java nor the Firebase CLI, so the emulator suite could
  not be run either. The screens are reasoned from the tokens and the shared
  components, not observed. Worth clicking through the hand-off once
  (admin → manager → manager's Data Bank → employee) before relying on it.

  **Nothing new needs deploying** — the hand-off reuses the `subAdminUid` shape
  the folder rule already checks, and no index was added. The
  `followUps.dayKey` collection-group override is still owed from 2026-09-03;
  until it lands the report runs its per-lead fallback and says so.

### 2026-09-04 — The reports error was missing Admin credentials; dossier cuts made disjoint; one directory for both roles

**The report error, proven rather than reasoned about.** "Something went wrong
on our side" after 7.9 seconds, with nothing in the browser to go on. The
decisive step was a throwaway `/api/credcheck` route doing one Admin SDK read
**from inside the running dev server**, so the answer came from the process's
own environment rather than from what a separate script could see:

```json
{ "ok": false, "ms": 7308, "credentialFailure": true,
  "hasExplicitCredentials": false,
  "message": "Could not load the default credentials." }
```

`FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` are **empty** in
`.env.local`, so `getAdminApp()` falls through to Application Default
Credentials, and there is no ADC on this machine. Every Server Action spends
~3s per call probing the GCE metadata server and then fails; the report makes
two such calls, which is the 7.9s.

**Why it looked like one broken screen.** The browser reads Firestore with the
`NEXT_PUBLIC_*` web config and the signed-in user's own token, so leads, the
Data Bank and every list kept working perfectly. Only Server Actions —
`firebase-admin` — were dead. That is the most misleading shape a failure can
have, and `runAction`'s catch-all turned it into a sentence that sends people
looking for a bug in the screen.

So the condition now names itself, the way the quota error already does
(`lib/configError.ts`):

- `isCredentialFailure()` matches the shapes it actually arrives in — the
  `google-auth-library` message, a missing project id, `invalid_grant`,
  `app/invalid-credential`, and `UNAUTHENTICATED` **only when the text agrees**
  (a bare 16 is also a revoked user token, which is a different fix).
- `runAction` returns a message naming both variables and where the key comes
  from, and says the browser will keep working — the half that stops the hunt.
- **The diagnosis is sticky.** Credentials do not appear while a process runs,
  so after the first failure every later action returns in milliseconds instead
  of re-discovering it for three seconds.
- `getAdminApp()` warns **at startup** when it is about to rely on ADC, so the
  terminal says so before anybody clicks anything.
- `npm run diagnose:report` replays the whole report query sequence against the
  live project, timing each step and printing the real error.

**Nothing in the code could have fixed this** — it is `.env.local`. What the
code owed was to say so.

**The report is also faster, which the 7.9s was hiding:**

- **`karachiDayKey` per row is gone.** It is an `Intl.DateTimeFormat` per lead
  *and* per deal; Karachi is a fixed UTC+5 with no DST, so the range is one
  millisecond interval computed once (`karachiWindow`) and every comparison is
  two integers.
- **Leads and deals now go out together.** They depend on nothing but the uid
  list and were two sequential round trips.
- **The collection-group fallback is pruned by `lastFollowUpAt`.** Only leads
  whose newest entry postdates the range start can hold one inside it, so a
  pipeline of 3,000 worked leads no longer means 3,000 subcollection queries to
  find the handful of people who logged something this week. Safe because an
  entry can only be **back**-dated: `dayKey` comes from `occurredAt`, which
  cannot be later than the write.
- A `[report]` line prints the phase breakdown whenever the whole thing exceeds
  2s, naming leads+deals against activity and whether the index was missing.

**Dossier cuts: Remarks and Follow-ups are now disjoint.** They were `>= 1` and
`>= 2`, so every followed-up lead also sat in Remarks and the Remarks cut could
not answer the only question it exists for — who has been remarked on and not
chased yet. Remarks is now **exactly one entry**; the first follow-up moves a
lead out of it. The two partition the worked leads, which a test asserts across
0–12 entries.

**Connected deliberately still cuts across both** — it asks whether a call was
answered, which can happen on the Remark or on any follow-up. It reads
`connectCount`, so a call shorter than `CONNECT_MIN_SECONDS` (1:10) is contact
and not a connect; counting it here would make the dossier, the KPI and the
report disagree about the same call. The chip hints now say all of this, and
**every chip carries its count**, because a reader otherwise cannot tell a
filter that found nothing from a filter that is not working.

**Team is one screen for both roles.** `/subadmin/team` was a different page
entirely — a plain table where the admin has the directory. Both now render
`components/employees/DirectoryView`, so the hero, the stat cards, the roster
with its search and Active/Inactive filter, the pagination, the dossier and the
whole phone layout are the same by construction rather than by maintenance.

**What differs is authority, not appearance.** Create, edit, pause, set a lane
priority and recalculate the lane are all `requireAdmin` **on the server**, so
for a sub admin those controls are *absent* rather than present-and-failing —
offering a button whose only outcome is "That action is for administrators" is
worse than not offering it. The Managers panel is admin-only too: a sub admin
enumerating their peers, their team sizes and their revenue is the cross-team
visibility §22 forbids. Everything that reads is identical.

**Found while doing it, and the reason the old page showed zero revenue:**
`useFinancials` read the whole `closedDeals` collection with no scope. Firestore
checks a *list* query against the rules before running it, and the sub admin
clause is `subAdminUid == me`, so the query was **refused outright** — the team
page had been showing Revenue 0 with a `permission-denied` in the console. It
now takes a scope and adds that clause (the `subAdminUid, enteredAt` index
already exists). Expenses are the company's and have no scoped form, so a sub
admin simply does not read them.

- **Validation**: `typecheck` 0 errors, `test` **356/356** (346 → 356: 8 on the
  credential shapes including the UNAUTHENTICATED-that-is-not-one, plus the
  disjointness proof and the too-short-call case), `build` compiles, `eslint
  src` at the 7 pre-existing errors and 34 warnings. Five routes smoke-tested.

  **The report cannot be exercised until the credentials are set** — every
  Server Action fails without them, so the speed work above is reasoned from
  the query shapes rather than measured. Set `FIREBASE_CLIENT_EMAIL` and
  `FIREBASE_PRIVATE_KEY` in `.env.local`, restart, and the terminal's startup
  warning will stop appearing.

  **Still open, and the owner's call:** "managers have authority on their own
  employees" was asked for and is *not* delivered, because every employee write
  is `requireAdmin` and `updateEmployee` carries `monthlySalary` and
  `subAdminUid` among its fields. Letting a Sales manager set salaries or move
  people between teams is not something to grant by loosening one guard.
  Granting it means naming the subset of fields a manager may write.

### 2026-09-04 — The empty Client folder, and indexes without the CLI

**A manager's own Client folder rendered with no leads in it.** The folder was
listed, the count on the card was right, and opening it showed nothing.

`useClientFolderMembers` queried `where('folderId','==',id)` and nothing else,
but the rule on `clientFolderLeads` is `subAdminUid == request.auth.uid`.
Firestore checks a **list** query against the rules *before* running it, so a
query that cannot prove that clause is refused in full — not filtered down.
Hence a folder whose own document was readable (that query *is* scoped) holding
rows that were not. Third time this class has shipped; `useFinancials` was the
second, earlier the same day.

Verified against the live project rather than assumed: the manager's folders and
every membership row already carried the right `subAdminUid`, and the leads
behind them were correct. Nothing was wrong with the data — only the read.

**Ordered in memory, deliberately.** The obvious fix adds `subAdminUid` beside
`folderId` and keeps `orderBy('addedAt')`, which needs a three-field composite
index that does not exist and that this project cannot currently deploy. Two
equality filters with **no** `orderBy` are served by the automatic single-field
indexes, so the query needs nothing new and the rows — already capped at 300 —
are sorted client-side. A fix that depends on an index nobody can create is not
a fix.

**Indexes without the Firebase CLI.** `npm run deploy:indexes` reads
`firestore.indexes.json` and creates what is missing through the Firestore Admin
REST API with the service account already in `.env.local` — composite indexes by
`POST`, and **field overrides by `PATCH`**, which is what the console calls
*Single field → Add exemption* and the only thing that makes a collection-group
query work. `--dry` lists first; re-running is safe (409 counts as "exists").

Two things it got wrong on the way, both now fixed and worth remembering:
`updateMask` is a FieldMask and serialises as `?updateMask=indexConfig` — the
obvious `updateMask.fieldPaths=` is rejected as an unknown parameter; and the
`PATCH` replaces the field's **whole** `indexConfig`, so all three scopes have to
be sent together or the ordinary per-collection indexes are dropped.

**It is blocked on one IAM role**, which is the owner's to grant: a Firebase
service account can read and write documents but cannot manage indexes until it
has **Cloud Datastore Index Admin**. The script detects the 403 and prints the
account, the console link and the role name rather than the raw error. Runbook
§3a covers it, and the report's on-screen warning now names the command instead
of a console path that is genuinely hard to find.
