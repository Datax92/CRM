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
| `docs/accounts-ledger.md` | **The central ledger** — model, split-payment rule, StateLife's exact columns, migration plan. `components/accounts/accountsChrome.tsx` is the section's visual language |
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
- Auto-distribution sorts by **priority 1–10** (1 = front) and gives **each person their own turn size** (`users/{uid}.leadsPerTurn`, 1 to `MAX_LEADS_PER_TURN` = 10, default `LEADS_PER_TURN` = 1): Aroosa at 2 and Rafia at 1 runs A, A, R, then the next person, then back to the top. Set per person on the Lead Lane screen (owner, 2026-09-17); the lane-wide figure was 8, then 5, then 1. `normalizeLeadsPerTurn` is the one reader — zero, junk or a string falls back to the default, so a number can never take somebody out of the lane; that is the switch's job. Rotation governs incoming volume only, and **no test hardcodes the number** — they are written against the constant, or they only prove what it used to be.
- **The admin runs the lane from the Lead Lane screen** (`PriorityLaneView`, `updateLaneSettings`): in rotation or not, leads per turn, priority, and a lock. **Setting a priority by hand locks it**; the lock button unlocks it for automatic ranking again. `updateLaneSettings` writes `autoAssign` **explicitly** either way, because the default differs by role.
- The assigned employee has a **5-min accept window**. On a miss the lead cascades strictly down the priority lane, skipping anyone who already let it expire (`resolveCascadeAssignee`), and a `RED_FLAG` notification + `missedLeadsCount` increment is recorded.
- **Passing on is not missing.** `passLead` is the employee saying no, from the arrival popup or the lead pane: it cascades by the same `resolveCascadeAssignee` and loops back to the top when everybody has had a turn, but writes **no `RED_FLAG` and no `missedLeadsCount`** — a red flag is for silence, and punishing somebody for answering honestly would teach them to let the window lapse instead. The cost is on the lane, where it belongs: `passes` is incremented in `kpiMonths` and costs 2 points on the next ranking, and the popup says so before the button is pressed.
- **A Meta lead is offered to the lane the moment it lands.** `fileAndOfferMetaLead` files the record into the admin's Data Bank (unchanged) and then promotes it into a lead `ASSIGNED` to whoever holds priority 1, with the five-minute window — so the popup, the cascade and the Railway sweep finally have a source. **Straight to the lane, no admin holding window**, at the owner's instruction: these are paid leads and the first call should not wait on an admin who is probably not watching. The admin still sees it, counted under *In pipeline* rather than *To give out*, and can reassign it. **An empty lane leaves the record in the Data Bank** rather than creating a lead with no owner — a record waiting in a folder is a normal state somebody can act on, an unassigned lead is something to go and clean up. Promotion, never duplication: the row moves to `PROMOTED_FOLDER_ID` exactly as a hand-promoted one does.
- **A folder can name who its leads are for** (owner, 2026-09-22). `dataBankFolders/{id}.laneUids` — set from **Who gets these leads** on the Meta Ads card (`FolderLaneModal`, `setFolderLane`) — restricts *that folder's* automatic distribution to the people chosen: employees, managers **and the admin**, one or many. It is the same lane drawn round fewer people: priority order, each person's own `leadsPerTurn`, the five-minute window, the popup, Pass on, and the loop back to the group's own first person **inside the group**, so a lead routed to a desk goes round that desk for as long as it takes and never cascades off it. Rules that hold it together:
  - **Empty is the absence of a rule, not a rule that nobody gets them.** Absent, junk or `[]` all mean the whole rotation (`normalizeLaneUids`), so this can never be the reason a paid lead reaches nobody. The card says which state it is in, in words.
  - **Chosen beats `autoAssign: false`; nothing beats `DISABLED`** (`readChosenLaneMember`). Being out of the general rotation is a statement about ordinary volume; being named on one folder is the later, narrower instruction. A paused account is refused at the picker, because a lead left with them is a lead nobody can work.
  - **The restriction rides on the lead** (`leads/{id}.laneUids`, stamped at creation), not on a join back to the folder: a cascade five minutes later costs no folder read and cannot change under a lead already in flight. One reader for all three automatic paths — the Meta intake, the cron sweep and Pass on — is `lib/server/laneRoster.ts`, because the last time that roster mapping was written out three times one copy stopped reading `autoAssign`.
  - **A restricted folder counts its turns separately** (`config/distribution.folderCycleState.{folderId}`). Sharing the lane-wide counter would spend somebody's turn on a lead only their dedicated group ever saw, so the next ordinary lead would skip them.
  - **The admin is offered leads like anybody else when they name themselves**, so `useIncomingLead` now runs for `role === 'admin'` too. It was employees and rotation managers only; without this the lead would land with the admin, show no popup, lapse, raise a red flag against them and cascade away. An admin still never sees an unasked-for offer — a hand-assigned lead is written `ACCEPTED` outright.
  - **Automatic distribution only**, at the owner's instruction: promoting or reassigning a row by hand is a decision and reaches anyone, as before.
- **A Click-to-WhatsApp message is a lead only if it came from an ad** (`/api/webhooks/whatsapp-bridge`, fed by the Make scenario in `docs/integrations/make-whatsapp-scenario.md`). The number is the business's everyday WhatsApp (on Coexistence, so the phone app keeps working); a message without an ad referral answers `NOT_FROM_AD` and files nothing. **Grouped by campaign**: `resolveCampaign` looks the ad id up, so a WhatsApp lead lands in the same `meta_campaign_{id}` folder a lead-form ad in that campaign fills. The lookup needs `META_ADS_ACCESS_TOKEN` (system user, `ads_read`) — a Page token cannot read an ad — and falls back to one folder per ad rather than refusing the lead.
  - **Meta can deliver these directly, without Make** (owner, 2026-09-23). `/api/webhooks/meta` now also takes `object: whatsapp_business_account`, field `messages`, signed with the same `META_APP_SECRET` — so the Page's `leadgen` webhook and the WhatsApp one must be on **one app** (the "CRM" app, 1983475865567694). `splitCloudApiMessages` (`lib/whatsappIntake`) turns one `value` into one body per message and drops delivery/read `statuses`, which arrive on the same field. **Both routes call `fileWhatsAppMessage`** (`lib/server/whatsappFiling`), so running Make and the direct subscription side by side files each person once — the message id and the phone rule catch the second copy — and Make can be switched off once the direct path is proven. Meta sends production webhooks to a **Live** app only. Probed 2026-09-23 (read-only): `META_APP_SECRET` in `.env.local` is the CRM app's, and the Page's only subscribed app is CRM (`leadgen`) — Make's WhatsApp side runs on Make's own app. Publishing needs a privacy policy URL, which is `/privacy` (public, no sign-in; `#deletion` is the data-deletion instructions). It describes what intake actually collects, so change it if intake ever reads more. **Set up 2026-09-23:** the CRM app is subscribed to WABA 106227469025089 (+92 311 1555426, Coexistence, `is_on_biz_app: true`) beside "Make for Business Messaging", with the `messages` field on the app webhook. Make stays on until a direct lead is proven.
- **The lane is a loop, and has no floor** (owner, 2026-09-22). When the last person in the queue lets the window lapse, the lead goes **back to priority 1** and round again, for as long as it takes somebody to accept (`resolveCascadeAssignee` returns `wrapped`, and every caller replaces `attemptedAssignees` with the new holder so the next lap can start). It used to *force-accept* at the end — the last employee left got the lead with no window and no way to decline — and the owner's instruction is that a lead nobody has accepted keeps being offered rather than being parked on whoever happened to be last. Consequences, all deliberate:
  - **A miss is red-flagged and charged once per person per lead, not once per hop** (`leads/{id}.missedAssignees`). A lead nobody accepts is re-offered every sweep, so the same person can let the same lead lapse ~40 times a day; red-flagging each one would bury the panel and multiply `missedLeadsCount` by how long the lead went unclaimed, which measures the lane's luck rather than the person. The `EXPIRED` **event** is still written every hop — that is where "this has been round four times" has to be legible — and `cascadeLap` counts the laps.
  - **A one-person lane re-offers to that person** with a fresh window each time. First and last are the same person; the rule taken literally is the owner's answer.
  - **It never stops on its own.** At a five-minute sweep an unaccepted lead costs ~288 hops a day — about 860 writes for one lead, against a 20,000/day cap. Five such leads is a fifth of the budget. That is the stated price of "loop until accepted"; a lap cap would be a different instruction.
  - `UNASSIGNED_NO_CAPACITY` is now reachable **only** when the lane is genuinely empty — no active member at all.
  - **The lane has a night** (owner, 2026-09-23). An offer made between **22:00 and 09:00 Karachi** is given a deadline of **09:00 + the window** (`acceptDeadlineFrom`, `lib/distribution`), used by every place an offer is made — the sweep's auto-assign and cascade, Pass on, the Meta intake and the demo store. The holder can accept overnight; at 09:05 the lane carries on as by day. It replaced ~130 overnight hops per unaccepted lead (~15 reads, ~4 writes and a red flag each). Order, rotation and who is offered first are unchanged. Countdowns over an hour read `10h 04m` (`formatTimeLeft`).
- **Admin actions bypass the lane.** Assign, reassign and promote write `ACCEPTED` + `acceptedAt` immediately and delete `acceptDeadlineAt`. An admin handing out a lead is a decision, not an offer.
- **The cascade never advances rotation counters.** Cleaning up a colleague's miss must not consume your turn.
- **Moving a lead writes its name too.** Every write that changes `assignedUserId` — the cron's auto-assign and cascade, Pass on, the manual paths — writes `assigneeName` from `laneDisplayName`. The cascade and Pass on used to move the uid alone, so a lead that went Aroosa → Rafia still read "Aroosa" in search and in the duplicate message that names who holds a number. Repaired 2026-09-17 (5 leads).
- `autoAssign: false` takes someone out of distribution *and* the cascade while leaving them able to receive a manual assignment. **The default differs by role** (`laneMembership`, read by the server rosters *and* the `useEmployees` mapper, so the screen cannot disagree with distribution): absent means **in** for an employee, **out** for a manager — reading a manager's absent field as in would have handed leads to every manager on deploy.
- **A manager can be put in the rotation.** They are then an ordinary member of the lane: offered in priority order with the same popup, five-minute window, Pass on and cascade, ranked by the same score unless locked (`recalcPriorities` ranks every active employee plus the managers in rotation). The rosters in `metaDistribute`, the cron and `passLead` read `role in ['employee','subadmin']`. **Every move stamps the recipient's team** (`owningSubAdminFor` — a manager's own uid), or a Sales manager's `leads` rule (`subAdminUid == me`) would refuse them the lead they were just offered; the cascade and Pass on used to leave the previous person's team on the lead. The manager's popup query carries `subAdminUid == me` for the same rule, and `/subadmin/meta-leads` is the employee screen filtered to their own leads. Both live managers were `autoAssign: false` when this shipped.
- **Meta Leads looks exactly like the admin's Meta Ads, for everyone** (owner, 2026-09-17). One card per campaign folder (`MetaCampaignCard`, shared), opening onto the folder's lead list (`AssignedLeadRow`, shared with the Data Bank's Assigned half) with `LeadDetailPane` / `MobileLeadDetail`. An employee's and a rotation manager's cards are **derived from their own leads** (`lib/metaLeadGroups`) — `dataBankFolders` are managing-roles-only — keyed by the `dataBankFolderId` every ad lead carries, so it is the admin's folder by the admin's key. A lead added by hand into an ad folder is on the card, as it is in the admin's Assigned list. **Nobody there can reassign**: no selection, no reassign bar, no handler to the pane. Offers (Accept / Pass on) sit above the cards.
  - **A manager's Meta Ads is their team; their Meta Leads is their own** (owner, 2026-09-23). `/subadmin/meta-ads` is `TeamMetaAdsView` — the admin's card layout, built from the manager's `useLeads` (their team's leads plus their own), because the admin's campaign folders are not the manager's and the shared `MetaAdsView` rendered empty for them. A card opens `/subadmin/meta-ads/{folderId}`, which is `MetaLeadsFolder scope="team"`: every row names its holder, with the admin's who-holds-it picker. `/subadmin/meta-leads` is unchanged — only leads assigned to the manager. No reassign on either, as on a manager's leads screen.
  - **An `AssignedLeadRow` must sit in a row wrapper.** It is `flex-1`; as a direct child of the list's flex column it grew to the list's full height, so one lead drew as a tall box with its name mid-way down (the Meta Leads folder, fixed 2026-09-23). The admin's list always wrapped it.
- Closed leads (Closed Won / Closed Lost / Not Interested) cannot be reassigned.
- Windows and the 1–10 scale are defined once in `src/lib/constants/distribution.ts`, including the minute figures used in user-facing copy, so wording cannot drift from the clock.

## Leads

- **The pipeline is inbound only.** Meta Ads intake plus records promoted out of the Data Bank. There is no Add Lead on the leads screen. (`AddLeadModal.tsx` / `MobileAddLead.tsx` are kept, complete and unused, for a possible one-off referral case.)
- **Pipeline Status** is the formal state machine (`leadStatus.ts`). **Pipeline Stage** is the commercial read — **Cold → P3 → P2 → P1** — derived from status by `STATUS_STAGE` and rendered by `pipelineStage.ts`. Stage is a read-out, not a control; the status select is grouped by band so choosing a status shows what it does.
  - P3 talking (Accepted → No Response, **Negotiation**) · P2 they showed up (Meeting Done, Site Visit Done) · P1 closing (Document Received, Token Received, Deal Closed).
  - **Accepting a lead is not progress on it.** A lead at ACCEPTED with no entries carries **no band at all** (`awaitingFirstEntry`); writing its first Remark makes it P3. Every other P3 status is a deliberate act by a person, so those take the band immediately. Derived from `followUpCount` — no backfill, nothing to go stale.
  - `tokenReceivedAt` is stamped one-way when the status first reaches TOKEN_RECEIVED. The status moves on to Deal Closed; the fact that token money arrived does not, so the report reads the stamp rather than the current status.
- **Cold is decided, not inflicted.** `meetsColdRule` (10 follow-ups without reaching Seems Interested) raises `coldPending` and notifies the admin *and* the lead's manager once, guarded by `coldReviewRequestedAt`. `reviewColdLead` writes the decision; dismissing clears the flag so the rule can raise it again. The employee is told either way.
- **Source is a filter on the leads screen and in the dossier**, keyed on the exact string `describeLeadSource` prints (`sourceOptions`, `filterBySource`), so the filter and the row can never disagree. On the leads screen it is `?source=` beside `?filter=` and the formerly decorative sliders icon opens it; in the dossier it is `DossierFilters.source`, applied in `applyLeadFilters` before the cuts so the chip counts describe that source. **Its option counts are for the chosen period** (the leads `applyLeadFilters` returns for that period with no cut and no source), never all-time — a lifetime total beside "Today" read as wrong.
- **Lead source names the exact origin** — `Data Bank (Facile Town 2)`, `Meta Ads (Ramadan Offer)` — from fields denormalised onto the lead at creation, never a live join (`lib/leadSource.ts`). A folder rename must not rewrite a lead's recorded origin.
- **Meeting Aligned is a fact about the entry, not about the lead** (owner, 2026-09-22). A checkbox beside *Meeting Held* on every entry form — the desktop pane, the phone sheet and `LeadDetailModal` — saying a meeting was **agreed** on this contact. Held is what happened; aligned is what was booked, and the common day is the second without the first. Stored on the entry (`meetingAligned`), counted in the range by `entryTally.meetingsAligned`, and one-way on the lead (`meetingAligned`, `meetingAlignedCount`) for the all-time reading. It shows in three places, all from the same classification: the dossier's activity strip, a **Meeting aligned** chip cut, and a **Meetings Aligned** column in Reports — placed in *Activity in range*, not *Outcome*, because aligning a meeting is something the person did on a call in that range; whether it then happened is the *Meetings* column, and the gap between the two is the number worth reading. **Deliberately not wired into `pipelineStage`**: a date in the diary is not a meeting held, and lifting a lead to P2 for one would overstate the pipeline. Not in the KPI either — `kpiScore`'s three weights and the lane's `leadScore` are unchanged.
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
- **A Manager is not an employee.** Own Add Manager form: no KPI targets, no job title, and out of the lead rotation unless an admin puts them in from the Lead Lane screen (see **Distribution**). Their analytics are **their team's plus their own**, summed on read (`lib/managerMetrics.ts`) with conversion team-wide (won ÷ handled), never an average of per-person rates — the same set `reportScope.teamOf` builds, so the directory card, the manager's dossier and Reports agree on one number. `headcount` stays the *team* size. **Clicking a manager opens the same `EmployeeDetailModal` an employee row does**, given their team: pass `team` and it is a manager's dossier (Team Leads / Deals / Team / Activity / Analytics, team-scoped), omit it and it is an employee's. One component, because two would drift. Their lead view is read-only for **their team's** leads — the server books follow-ups and deals against the *assigned employee*, so a manager logging one would credit somebody else's KPI. **A lead assigned to the manager themselves is theirs to work**: a Data Bank record promoted into their Client section, or one handed to them, carries `assignedUserId = their uid`, so the entry credits them. `canWorkLead` always allowed it; only the two panes refused, which is why a manager could open a lead in Clients and not write a word on it.
- `managerKind` (SALES / HR) rides in the **auth claim**, because the sidebar must know before it can draw. Changing it re-issues the claim and revokes the token. An older manager with no claim reads as SALES.
- **HR's reach is the company; a Sales manager's is their team.** One predicate, `isHrManager`, and every surface asks it: attendance, leave, office expenses, salary, the report subjects — and, since 2026-09-09, **lead distribution**. An HR manager reads the whole pipeline (`useLeads(..., companyWide)`, mirrored by `isHr()` on the `leads` rule) and hands any lead to any active employee whatever team they are on (`canAssignLeadTo`, asked by `assignLead`, `reassignLeadManual` and `assignLeadsBulk` alike). **The lead files under the recipient's manager, never the assigner's** — `assignmentStamp` takes `subAdminUid` off the employee — so a lead HR gives to one of B's people lands in B's pipeline. A Sales manager is unchanged.
- Employees see only their own leads; a sub admin only their team's — enforced in rules *and* server actions. **Every read hook takes a scope for this reason**, not as an optimisation: `useLeads`, `useEmployees`, `useDataBankFolders`, `useFinancials` and `useClientFolderMembers` all add the clause their rule checks, and an unscoped list query is refused outright rather than returning less. This has now shipped as a bug three times — the symptom is always a screen that renders with *nothing in it* rather than an error.
- **The admin directory and a sub admin's Team page are one component** (`DirectoryView`), because two implementations of "the team" drift. Every mutating employee action is `requireAdmin`, so a sub admin gets the same screen with those controls **absent** rather than present and failing.

## Money

- **A deal has a type, and the type decides everything.** Down Payment · Confirmation · Installments · Lump Sum, chosen first on the form; `lib/dealAmounts` owns the arithmetic and the desktop form, the phone and the Server Action all run it, so a deal cannot come out differently depending on where it was entered.

  | type | typed | calculated |
  |---|---|---|
  | Down Payment | Total Price, Down Payment, Adjustment | `Remaining = Total − Adjustment` |
  | Confirmation | Total Price, **Confirmation**, Adjustment | `Remaining = Total − Adjustment` |
  | Installments | Amount Received, Payable Amount | `Remaining = Received − Payable` |
  | Lump Sum | Amount Received, Payable, **Commission** | **nothing — there is no Remaining** |

- **The Cut has two different numbers and confusing them is the whole risk.** The **base** is what the admin's percentage multiplies; the **source** is the pot the money leaves. `readCutBase` and `readPayoutSource`, never one for the other:

  | type | Cut calculated on | Cut paid out of |
  |---|---|---|
  | Down Payment | **Remaining** = Total − Discount − Adjustment | **Down Payment** (or Token Received) |
  | Confirmation | **Remaining** = Total − Discount − Adjustment | **Confirmation** |
  | Installments | **Amount Received** | Remaining |
  | Lump Sum | **Amount Received** | **Commission** |

  **Priced types changed 2026-09-24 (owner):** with no discount or adjustment, Remaining *is* the Total Price. A split larger than the down payment is **refused**. For priced deals `readCutBase` / `readPayoutSource` **derive from the figures and ignore the stored copies**, which were written under the old rule, so a pending deal is split by the rule in force now. **Discount** comes off the price before the adjustment and out of the revenue mirror (`amountReceived := Total − Discount`). **Token Received** is a label on the down payment (`downPaymentKind`), not arithmetic. **The company may take a named cut** (`COMPANY_BASE` line, % of the base, counted in the rupee test); its total is its cut plus the unallocated rest (`companyRetained = source − people`). **The admin edits a closed deal** (`updateClosedDeal`, `EditDealModal` — Profit Distribution, Closed Deals, and the lead's deal record, both widths): figures recomputed, previous values in `revisions`, KPI counters moved by the difference, and a finalised split reopened when the money changes.

  The superseded rule, for reading old records: 50 lakh total less a 10 lakh adjustment: base 50 lakh, source 40 lakh, so 1% is **50,000** taken out of the 40 lakh. A lump sum where the client paid the builder 40 lakh and the builder paid us 4 lakh: base 40 lakh, source 4 lakh, 1% is **40,000**, leaving the company 3.6 lakh. Both numbers are stored on the deal at entry and frozen again on the split, so a later rule change cannot restate what anybody was paid.
  - **This supersedes the single-base rule** recorded on 2026-09-05, under which the same 50 lakh deal gave a 1% cut of 40,000. Nothing needed migrating: no deal had ever been saved in that shape.
- **The Cut itself is the admin's, in Profit Distribution.** Deal Entry stores the figures and offers no percentage — a second place to set it would be a second answer to a question that must have one.
- **The company keeps what is left of the source, and since 2026-09-24 may also name a cut of its own** (a `COMPANY_BASE` line with its own % box). `companyRetained = payoutSource − what people are paid` = company cut + unallocated. The company line gets no `dealPayouts` row. (2026-09-09 to 09-24 there was no company percentage.)
- **Over-allocation is refused in rupees, not percent.** With a base larger than the source, cuts well under 100% can still exceed the pot: 11% of a 40 lakh base overdraws a 4 lakh commission. Refused, never clamped.
- **A Lump Sum's revenue is the Commission, not the client's money**, which goes to the builder. The mirrors carry it, so no rollup books 40 lakh the company never had.
- **The Down Payment funds the payouts; it never changes them.** Shown beside the allocated total on the distribution screen, never enforced: a shortfall is often covered elsewhere. Not shown at all for a Lump Sum, where the commission *is* the pot.
- `amountReceived` and `payableAmount` are still written, as **per-type mirrors** chosen so `profit = received − payable` still lands on what the company books: `totalPrice`/`adjustment` for the two priced types, the typed pair for Installments, and **`commission`/0** for a Lump Sum. That is why ~30 readers — every revenue rollup, the KPI portfolio, the income sheet, campaign ROI, employee metrics, Reports — needed no change and no historical deal needed migrating. Nothing new should read them; use `lib/dealAmounts`, whose accessors fall back for older deals. `readDownPayment` returns **null**, not 0, for a deal closed before the form asked — a confident `Rs 0` reads as a client who paid nothing.
- **A deal with no `dealType` is an Installments deal.** `amountReceived − payableAmount` is literally the Installments formula, so all seven existing deals keep displaying exactly what they displayed; their Cut base becomes Amount Received like any other Installments deal, at the owner's instruction, so one type never carries two rules depending on when the deal was entered. **Splits already finalised are frozen and are never recomputed.**
- **One display shape, four surfaces.** `dealFigureRows` and `dealCutRows` decide which boxes a deal has; the lead pane, the phone sheet, Closed Deals and the distribution header all render them. Four copies of "does a lump sum have a Remaining" is four chances to print one that does not exist.
- Profit = what the company books before the cut; net profit = gross − expenses.
- **A closed deal waits for the admin to split its profit.** `closeDeal` writes `distributionStatus: 'PENDING'` and notifies the admin.
- `dealDistributions` holds the whole split (**admin only**); `dealPayouts` holds one row per recipient (that person, their sub admin, the admin). Two collections because Firestore grants a whole document or none — one document holding all four lines could never satisfy the privacy rule. The company's share is never written to `dealPayouts`.
- Over-allocation is **refused, not clamped**. The remainder is the company's and is reported as its own line *and* inside the company total.
- **Re-finalising supersedes, never overwrites** (`current: false` + `supersededAt`).
- **Closed Deals is the historical record**, assembled on read: frozen facts from the deal, live ones from the lead (KYC, origin, assignment), the split from `dealDistributions`, history from the lead's follow-ups. Reopen lives on the distribution page, beside the thing it undoes.
- **Payroll is simple** (owner, 2026-09-25). A person has a **salary**, an **allowance** and a **joining date** (`monthlySalary` + `salaryProfile.allowances`, and the directory's `joinedAt`), edited from Payroll → **Salaries** by the admin **and HR**. A month is always **live** (`getPayroll`): salary + allowance, cut to the days from a mid-month joining (`joiningShare`, calendar days), + commission finalised that month − the attendance deduction **Attendance Settings** produces (a closed `attendancePeriods` month uses its frozen amounts); attendance before the joining date is ignored. No Generate / Review / Approve / Delete; `payrollPeriods` is no longer read (one Sept 2026 draft remains, never paid). **Paying is the admin's alone** (HR sees the figures, never the accounts): **Pay from…** writes `payslips/{uid}_{YYYY-MM}` with that person's figures at that moment, then `payFromAccounts`; from the first rupee paid, that person's line is read from the slip and does not move again. A slip is `APPROVED` while part-paid and `PAID` when settled; employees only see slips with money paid. The old five-part profile's allowances + bonus + other additions are read as the one allowance (`readSalary`), so the Rs 3,000 three people had is still paid.
- Salary figures: HR yes, other managers no, anyone else needs `salaryAccess: true` set per person.
- **Office expenses** extend the existing `expenses` collection. Records written before the module read as approved. Charts count **approved spend only**; total (invoiced) and spend (approved) are both shown. Renaming a category moves its records in batches; removing one does not. An approved expense is rejected, never deleted.
- **Office Expenses has a subject: whose expenses these are** (owner, 2026-09-22). A **Recorded by** selector — Everyone · Me · each person who has actually submitted one — and choosing somebody moves **every figure on the screen**, not just the list: the hero, the five stat cards, both charts, the CSV and *Pay period total*, which then pays their approved expenses and nobody else's. That is deliberate and is the one exception to **Hard UI rule 11**: status and category are *cuts* inside the record and leave the headline alone, but "whose are these" is a **subject**, the same question Reports asks, and the honest answer to *Tayyab's, this month* is Tayyab's totals. The options come from `expenseRecorders` — derived from the expenses, never the roster, so a choice can never return nothing — named from the manager roster with the expense's own `addedByEmail` as the fallback, and records predating `addedByUid` are gathered under **Not recorded** rather than dropped, or the parts would not add up to Everyone. The control is absent below two recorders, so an HR manager (whose read is already scoped to their own) never sees it.
- **Approving an expense and paying it are two different facts, and the screen shows both.** `status` says the company agreed to the cost; `paidAmount` / `paymentStatus` say how much has actually left an account, written **only** by `payFromAccounts`. The obligation never changes when it is paid — a 50,000 expense funded 30,000 is still a 50,000 expense with 20,000 outstanding. `readPaid` is the single reader (it clamps the paid figure to the amount, so a negative outstanding can never be printed), and a settled expense offers **no Pay button at all** rather than one that could only be refused.
- **A funded expense may be rejected; it may not be edited below what has been paid.** Rejecting was refused for one round and the owner reversed it: a payment that turns out to have been wrong is exactly when somebody needs to mark the expense rejected, and being sent to unpick the ledger first is a dead end at the moment they are recording what happened. The money does not go quiet — the funding transactions stay **posted** on the account that paid (the rupees really did leave it), the rejection is written into the expense's history, and the row's payment pill shows whatever the status, so a rejected expense that cost money reads `Rejected · Paid`. Removing the funding movement (`unpaySource`) is still what un-pays it, now a choice rather than a gate. The **amount** guard stays: an amount below `paidAmount` would leave a record insisting it was over-funded, and `readPaid` would report Rs 0 outstanding on something paid for twice over.

- **Paying a period's total** (`payExpensesTotal`, `PayPeriodTotal` on Office and Personal Expenses): one set of payment lines spread over every unpaid expense in the period, **oldest first**, by `distributeAcrossObligations` — each leg still names one expense and one account, each expense's `paidAmount` is exact, and there are at most `expenses + accounts − 1` legs. Office expenses must be approved; the outstanding figure is re-read inside the transaction; more than is owed is refused. Income accounts are offered first.
- **Investment with X** (`lib/investmentWithX`, `investmentBooks` / `investmentRounds`): one book per partner, one round per row of the owner's sheet. **Net = Profit − every share column** — reproduces every complete row of the photographed sheet; a book can switch to Gross. Share columns are per book, keyed and renameable; removing one that still holds an amount is refused. The net goes into `invx_{bookId}` (kind INCOME), one transaction per round (`invx_{roundId}`) dated the return date, rewritten in place; changing the net basis re-posts every round. **The amount comes out of an account and goes back** (owner, 2026-09-16): a round's `funding` names one account (it takes the whole amount) or a split that must add up exactly; `invx_{roundId}_out_{accountId}` leaves on the date and `…_back_{accountId}` returns on the return date, both typed `INVESTMENT` so `isIncomeMovement` never counts capital as income. An edit reads the legs actually posted and moves each balance by the difference; deleting a round puts un-returned money back. No account is allowed and is how every earlier round reads.
  - **Nothing comes back until the round is Received** (owner, 2026-09-23). The return date is when the money is *expected*; a round not received has **no** `invx_{roundId}` income row and **no** `_back_` legs — its net is not income and its amount is still out with the partner. **Received** (`setInvestmentRoundReceived`, a two-way **Awaiting | Received** switch on each sheet row, the phone's action, or the tick on the round form — the owner moves a round either way himself) posts both, dated `receivedDayKey`. A new round starts not received; an edit keeps the round's state unless the form changes it. **Absent `received` reads as received** (`isRoundReceived`), because every round saved before this had already posted both — the 8 live rounds on 2026-09-23 all read received, including 6 whose return dates had not arrived, and are the owner's to mark not received. Un-receiving takes both back out and is refused once the book's account has spent below it. Balances move by `postedEffect` of what is actually on the ledger, never by the round's stored net.
- **Mahziyar Group** (`lib/groupFinance`): **Group Expense** is one month — office (approved) + personal + lines added by hand, the month's income, and a **closing** that computes the figures *on the server* and freezes them on `groupMonths/{YYYY-MM}`. **Group Income** is the year as the owner's `MAHZIYAR PERFORMANCE` sheet. Both read `useGroupFigures`, so they cannot disagree. **Income is the income modules' ledger rows** (Marketing, Car Sale, StateLife, Investment with X) plus manual INCOME movements — never transfers, committee pots or reimbursements; **spending is read from the obligation records**, so an unpaid bill still counts as spent. Every income line and every cell can be edited over the automatic figure (stored beside it, reset brings it back); fields are added in `groupFinanceConfig/main` and removed ones are archived, not deleted. A closed month refuses its own edits **and** create/edit/decide/delete of office and personal expenses dated in it (`lib/groupMonthGuard`) — paying is still allowed. Reopen is the admin's. The screens are admin-only.
- **Receivables & Payables** (`lib/receivableSheet`, `receivableEntries`): the owner's two sheets, in named groups. **Just a sheet — no account moves.** `AMOUNT PENDING` is derived; settling adds to `settled` and refuses more than is pending. The 10 rows on the old Receivable screen are brought in by a button on the new one (`importLegacyReceivables` — copies and marks `migratedTo`, never deletes).

## Alerts

- **The admin's panel is an allow-list of five** (owner, 2026-09-22): **check-in · late arrival · absent · deal closed (profit to split) · a lead promoted to P2 or P1**. `lib/adminAlerts` holds it and `useNotifications` applies it to `targetRole: 'admin'` rows only — an employee's and a manager's bells are untouched. An allow-list, not a block-list, because the opposite shape leaks by default, which is how the panel became a log of everything the system does.
  - **Filtered after the read, not in the query.** A `type in [...]` clause needs a composite index this project cannot deploy from a dev machine, and a query with a missing index is **refused outright** — the bell would render empty, which is this codebase's most-repeated symptom. The admin's window is 60 rows instead of 20 to pay for what is discarded, and the badge reads the same filtered list as the panel, or a bell saying 12 over an empty list reads as broken.
  - **The other alerts are still written and still reach the people they are about.** A red flag, a cold review, a leave request, an expense awaiting approval: all unchanged for managers and employees, and all still in `notifications` as the record they always were.
  - **Two new types.** `ATTENDANCE_CHECK_IN` — the admin only, and only the punch that *opened* the day, so a second tap sends nothing and a late arrival is announced by `ATTENDANCE_LATE` instead: one arrival, one alert. `LEAD_PROMOTED` — written by `setLeadStatus` when a lead **climbs** into P2 or P1 (`stageRank` compares the bands), so Token Received → Deal Closed is silent and a lead falling back is not reported as progress.
  - **"Mark all as read" is the admin's own now.** It used to clear every unread row in the collection, so one press emptied seven employees' bells — losing a red flag or a leave decision somebody was waiting on. Scoped to `targetRole: 'admin'`, which is also what clears the backlog of types the panel no longer shows.
- **A lead that has gone quiet reminds the person holding it, not the admin** (owner, 2026-09-22). `remindUncontactedLeads` (the cron's third sweep): a lead **already contacted at least once** whose last entry is older than `config/monitoring.noContactDays` (default **7**, set in Settings, 1–90) writes `LEAD_NO_CONTACT` to its assignee — employee or manager, by their role. A lead nobody has contacted yet is never reminded about: it is waiting on its first call, which the accept window and the lane already chase.
  - It replaced a 24-hour sweep that flagged the same leads to the **admin** — a management question that reached an inbox where nobody was going to ring anybody. `noFollowUpHours` is retired and deliberately **not** reinterpreted as days: reading 24 as 24 days would have silenced the reminder for the better part of a month.
  - **Once a Karachi day** (the `staleSweepDayKey` marker, unchanged — 165 stale leads on a 5-minute schedule is ~47,500 writes against a 20,000 cap) **and once per window per lead** (`noContactRemindedAt`), with a derived notification id so even a double run updates one row.
  - `status, lastFollowUpAt` is the right query and **its index is owed**; a missing one degrades to the indexed `lastActivityAt` query with a warning rather than taking the whole cron route down, and every row is re-checked against `lastFollowUpAt` either way.

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
- **The calendar is `docs/design/Attendance Calendar.dc.html`** (owner, 2026-09-18), and so is the palette: Present **teal** `#2f7d78` (it was green), Late `#8a6321`, Absent `#a8483c`, Leave `#8a7a21`, each with the file's tint, border and chip ground in `ATTENDANCE_TONES` — which every attendance screen reads, so the dashboard moved with it. One card, `CalendarPanel`, draws the team calendar *and* a person's own: the month as the title, the One person / Whole team toggle (team only), the stepper (never past this month), a legend bar whose chips carry the month's counts — **the team's totals in Whole team**, and the aside says so — and the grid. A cell shows the check-in time (`HH:MM`, a correction winning) beside a clock, as the file does; it used to show worked hours on a person's own calendar. A weekly off, a future day and an unrecorded day are the file's **empty day** — no tint, no stripe, a pale number. The file draws the desktop only; below 820px the cell keeps its marks, the pill's word becomes its letter and the time is left to the day's panel.
- `deriveStatus(0, true)` is `HALF_DAY` — a day checked in but not out is never graded absent. Half days count as **half** in the rate.
- Both punch buttons stay on screen all day; a control that disappears leaves no way to see what state you are in. **There is exactly one punch control in the app: the `/home` strip.**
- Approved leave leaves the denominator rather than counting against the employee. A request over balance is allowed to be *sent* — the form says how far over and the approver decides.
- **A closed month is frozen.** `finalizeAttendanceDeductions` copies the amounts, the salaries behind them and the rule each charge was made under, in words, into `attendancePeriods/{YYYY-MM}`. Open months recompute live. Reopening is its own action.
- `recordAttendancePing` is kept but no longer called — it is the only writer that could reconstruct a day from observed activity.
- **Calendar attendance editing (Admin & Sub-Admin):** Admin and Sub-Admin can edit any employee's attendance record (past or present) directly from the calendar (`/admin/attendance/calendar`, `/subadmin/attendance/calendar`).
  - Permissions are enforced on the backend: `adjustAttendance` in `src/app/actions/attendance.ts` requires manager tokens (`requireManager`) and allows Sub-Admins to edit their assigned team members as well as themselves (`uid === teamOf`). Employees cannot adjust.
  - Sub-Admin calendar page passes `canAdjust={true}` across all sub-admin types (not limited to HR).
  - Days without an existing Firestore document can be clicked and adjusted (`resolveDay` synthesizes default unrecorded day state).
  - Pre-populates check-in, check-out, and status in `DayDetailPanel` pinned to `Asia/Karachi` timezone without UTC date shift.
  - Changing times automatically recalculates `workedMinutes` and checks `classifyCheckIn` for tardiness against the active `AttendancePolicy`.
  - Audits adjustments in the `adjustments` array tracking `adjustedBy`, `adjustedAt`, `previousStatus`, `previousCheckIn`, and `previousCheckOut`.

## KPI

- MTD = month-to-date, YTD = year-to-date, and a KPI percentage is **actual ÷ target**. `lib/kpi.ts` takes both, never a pre-computed percentage. YTD target = monthly target × months elapsed.
- Three metrics: **Connects** (a typed call duration ≥ `CONNECT_MIN_SECONDS` = 70s), **Client Registration** (closed deals), **Meeting** (the meeting tick). Defaults 200 / 8 / 20 a month, overridable per person. `targets.revenue` (default PKR 3,000,000) is the Target Achieved denominator and is deliberately outside `KPI_METRICS`.
- **The connect flag is computed server-side** from the typed duration, never read from the client payload.
- Counters (`users/{uid}/kpiMonths/{YYYY-MM}`) are incremented **inside the same transaction as the work they count**, credited to `lead.assignedUserId` rather than the author, and dated by when the work happened — so a backfilled March deal lands in March.
- **There is no backfill.** Counters only count work logged since the KPI module shipped; a real account starts near 0% and climbs. Writing one needs a decision on whether historical calls, whose duration was never recorded, may count as Connects. They cannot be verified after the fact.
- `kpiScore` weights the three 40/40/20 with each **capped at 150% first**, or one runaway metric masks two failing ones. It is the measure of a salesperson and is used everywhere *except* the lane.
- **The lane is not the KPI.** `recalculatePriorities` ranks on `leadScore` (`lib/leadPriority`): `connects × 2 + follow-ups − passes × 2` for the current month, floored at 0. The lane decides who gets the **next** lead, so it rewards working the leads you already hold; closing a deal matters everywhere else and does not buy a place at the front of the queue. A connect is worth two follow-ups deliberately — equal weights would put somebody writing twenty notes above somebody who had ten real conversations. Passing costs 2, the owner's figure: enough that cherry-picking is not free, small enough that somebody driving can hand a lead on honestly. The floor is 0 because a negative score would sort a passer *below* somebody who did nothing at all.
- `assignPriorities` assigns 1..N, ties broken on uid; **an admin-pinned priority (`autoPriority: false`) is never moved**, and pinned people are passed in so their slots are reserved rather than handed to somebody else. Shared by the button, the nightly cron and the lane screen, which reads the same `kpiMonths` documents so it can always explain the order the job produced.
- **The dossier's activity cuts count entries written in the period, not the lead's
  record.** Five cuts — Remarks · New connects · Follow-ups · Follow-up connects ·
  Connected — each asking whether an entry of that shape was written *inside the
  chosen dates*. A remark that connected counts in **both** Remarks and New
  connects: the connect columns are a subset, never a second count. The entries come
  from `buildActivityBreakdown` (a Server Action — they are a subcollection per
  lead, so a range is a collection-group query) and are classified by `entryTally`,
  the same function Reports folds into its rows.
  - They used to read the lead's **all-time** `followUpCount` / `connectCount` with
    only the lead's *last touch* filtered to the period, so "Connected · Today"
    returned every lead touched today that had ever been connected with. Measured
    2026-09-09: an employee's dossier read **7 connects on a day she made 3**.
  - `tallyFor` keeps three states apart and they are not interchangeable: a tally
    (answer from the entries), **`null`** (the period's entries have not arrived —
    match nothing, never fall back), `undefined` (this caller has no periods at
    all — the all-time reading). Falling back while loading flashes the wrong
    answer before settling on the right one.
  - Remarks and Follow-ups are **no longer disjoint**: over one day a lead can be
    remarked *and* followed up, and both happened. The old "exactly one entry"
    reading answered "remarked and not chased yet", which is a question about the
    record, not about a day.
  - **The period can be one picked date** (`DossierFilters.day`, `karachiDayRange`)
    — a native date input, so every platform draws its own calendar. `DAY` is a
    `DossierPeriod`, deliberately **not** a `RangeKey`: five unrelated screens build
    their period dropdown from `Object.keys(RANGE_LABELS)` and would each grow a
    "pick a date" option with no date behind it.
- **The dossier opens on today, and the day is read when it opens** — `defaultDossierFilters()`, never a module-level constant: one evaluated at import time freezes "today" at whenever the bundle loaded, so a tab left open overnight shows yesterday under a control saying Today. `lib/dossierPeriod` is the single place a selection becomes a query, in the two shapes the data needs: a `Date` interval `[midnight, next midnight)` for the lists, and two identical `YYYY-MM-DD` keys for the entry query, so **one day's entries come back from Firestore rather than being hidden in the browser**.
- **The dossier's day summary counts entries; the chips count leads.** Same four words, different units, which is why the summary is headed with the date and the chip row is prefixed *Leads*. It is the row that used to read "Written in this period" — not redundant, but unlabelled enough to read as a duplicate.
- **A dossier period means "worked in", a report column means "entries written".** They are neighbouring questions and were being read as the same one. An employee's dossier counts **leads** and filters the period on **last touch** (`applyLeadFilters`); Reports counts **entries** in the range. Somebody who logs 30 follow-ups today across 30 leads is `30 / 41 worked` on their record and `5 Remarks + 25 Follow-ups` in Reports — both right. The dossier used to filter on `createdAt`, which answered "which of their leads were *created* today" and showed **nothing at all** for that employee; the two screens then looked like they were contradicting each other. The chip hints name their unit for the same reason.
- Reports (`buildTeamReport`, a Server Action) have **one subject at a time** — an employee, a manager (their own work *and* their team's), the admin, All Employees, or All Managers. Every figure is built per person once (`lib/reportScope`), and a composite subject is the sum of a *set of people*, which is what makes double-counting impossible rather than merely unlikely. New Connects is the *first* connected contact on a lead (its Remark), Follow-up Connects every later one — disjoint, or the columns sum to more than the work that happened. **Remarks and Follow-ups count every entry, connected or not**, and are deliberately not disjoint from the connect columns: a day of unanswered calls is real work and must not read as a zero. The activity columns are range-scoped; P1/P2/P3 describe where the leads stand today and say so.
  - **Reports reads day totals, not entries, from `config/activityTotals.from`** (default `2026-09-24`). `activityDays/{uid}_{dayKey}` holds the seven activity columns per person per day, moved by `writeActivityDelta` **inside the same transaction** as `addFollowUp` (new entry) and `updateFollowUp` (the difference), credited to the entry's own `creditUid ?? authorUid` and `dayKey`. `countsOf` must agree with `entryTally` — a test holds them together. Days before the start date are still folded from entries (`splitRange`), so nothing reads wrong before `npm run backfill:activity-days -- --confirm` fills them and moves the date back. Server-only: the catch-all rule denies clients. The dossier still reads entries, because it needs them per lead.
  - **Answered Calls and Hours Worked** (owner, 2026-09-24). An answered call is a logged call under `CONNECT_MIN_SECONDS` (1:10) — `callMade && !connect`, disjoint from both connect columns, in `countsOf` and `entryTally` alike. Hours are attendance's `workedMinutes`, **mirrored onto `activityDays/{uid}_{day}`** by `writeWorkedMinutes` inside the punch and `adjustAttendance` transactions (only once a day has a check-out), so Reports and the dossier get hours from documents they already read. Days before `config/activityTotals.from` read `attendance` instead (`attendanceMinutes`, cached 10 min). `npm run backfill:activity-days -- --confirm` fills both fields for every day, including the live ones.
  - **The dossier no longer reads the subject's leads** unless the collection-group index is missing (`loadEntries` takes the lead list as a function), and `useDossierActivity` remembers an answer for five minutes per range and set of people.
  - **Employees and managers have My Profile** (`/employee/profile`, `/subadmin/profile`, `MyProfileView`): the same `EmployeeDetailModal` / `ProfileOverlay` the admin opens from Team, about themselves — a manager's with their team. No Edit.
  - **The screen opens on Today and remembers a report for ten minutes** (`TeamReportView`, module-level, keyed by reader + range + subject). **Run always fetches fresh**; the header says "as of 14:05 · Run to refresh" once figures are over a minute old.

## Data Bank & Clients

- **A Meta campaign's folder is listed on Meta Ads and nowhere else** (owner, 2026-09-22). One folder appears per campaign the moment its first lead lands, so the Data Bank — a list of cold lists somebody *built* — was filling with folders nobody files by hand, sitting beside the sources they do. `useDataBankFolders` now hands them back as `metaFolders`, out of `folders`, by one predicate (`isMetaFolder`: the `metaSource` stamp, or a `meta_` id for folders older than it) so two screens cannot disagree about which owns what. Nothing about the folders, their records or their routes changed — `/admin/data-bank/{id}` still opens one, which is where Meta Ads links. The Data Bank header carries a count linking to Meta Ads, so a "disappeared" folder answers itself. **`listPersonalLeadFolders` is deliberately untouched**: an employee filing a personal lead into a campaign folder is the documented case above.
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
- **A number is refused if the folder already holds it, and the message names who
  holds it** (`duplicatePhoneMessage`) — "0300 1234567 is already in this folder —
  it belongs to Imran Khan." The name is the actionable half; a reader told only
  "already in this folder" has to search for the row by the number they were just
  told not to use. Scope is the folder plus its manager mirrors and **deliberately
  no wider**: two source lists legitimately hold one number, and a global rule would
  make importing a fresh sheet impossible. **Editing had no check at all** until
  2026-09-09 — adding a duplicate was refused, retyping an existing row's number to
  the same value was not, which walked straight round the only rule the folder has.
- **Nothing is dropped silently** — `prepareImport` reports every rejected row by line number. Existing numbers are skipped, never overwritten, and **a row handed to a manager still counts as held**: the dedupe scans the folder plus its mirrors (one query each, reusing the `folderId, phoneKey` index, and skipped entirely when `handedOffCount` is 0), or re-importing last month's sheet would recreate every handed-over row and put two people on one number.
- CSV is parsed in-house (quoted fields, embedded newlines, CRLF, the UTF-8 BOM). **.xlsx is still not parsed** — the importer says so and points at Save As → CSV.
- Chunks close on **whichever ceiling comes first, rows or bytes** (`chunkRowsByPayload`); a 500-row chunk of a 40-column sheet serialises to 1.93 MB against Next's 1 MB Server Action limit. `next.config.ts` sets `bodySizeLimit: 4mb` as headroom — raise the two together or not at all. Chunks stay sequential: each one's duplicate check reads what the previous committed.
- Records are **cursor-paged** (`CursorPager`, no page numbers) — this is the one list that can hold 40,000 documents.
- **Promotion moves, it does not delete.** The batch writes the lead, its event, its notification and re-parents the row to `PROMOTED_FOLDER_ID`; the tombstone is deleted afterwards, outside the batch, where failing costs nothing. `promotedLeadId` guards double promotion; `deleteDataBankFolder` sweeps by `promotedFromFolderId`.
- **Three destinations, and they are not the same operation.** An **employee** is promoted a lead into their pipeline. The **admin / yourself** is promoted a lead into their Client section — `ensureClientFolder`, deterministic id `db_{uid}_{sourceFolderId}`, so next week's import of the same source lands in the folder that already exists. A **manager** is handed the *record*, moved into their own Data Bank in a mirror of the source folder (`assignRecordsToManager`, id `mgr_{uid}_{sourceFolderId}`, carrying the source's fields and keys verbatim) — they then distribute it to their team, or take it themselves. `option.action` on the assign list says which, so no call site infers it.
- **Rows move, they are never copied.** Two documents for one prospective client means two people ring the same number. The admin still sees handed-over rows: the mirror is badged with the manager's name, and the source folder counts them as `handedOffCount`.
- A lead promoted out of a mirror files under the **original** folder's Client mirror, or one source fragments into a folder per route it took.
- **A Client folder holds references, never copies.** Membership ids are `folderId__leadId`. Deleting a folder deletes an *organisation* of the pipeline, never part of it.
- **Clients are personal, for every role, the admin included** (`lib/clientFolderScope`). The admin's folder query is unscoped because the rule allows it, and `useClientFolders` narrows it to the admin's own — without that, an HR manager's self-assigned leads landed in the admin's Clients and one source listed three times. **A folder shows only the leads currently assigned to its owner**; a lead reassigned away drops out, and its membership row is left in place so reassigning it back restores it. Card counts are derived the same way (`useOwnClientLeads`), never from the stored `leadCount`, which still counts reassigned leads.
- **A folder has two halves: Unassigned and Assigned.** Unassigned is its records, cursor-paged. Assigned is *derived on read* (`lib/dataBankAssigned`, `useFolderAssigned`) from where the rows went: leads whose `dataBankFolderId` is the folder or a manager mirror of it (`mgr_{uid}_{folderId}` — deterministic, so leads from a mirror that was cleaned up still count), plus rows sitting in a manager's mirror (admin only — a manager cannot read another's mirror). A picker lists every assignee with a count. Nothing is stored, so no backfill; a promoted row's tombstone is still deleted. **Assigned rows can be reassigned, one or many** (`ReassignBar`, and the lead pane's Reassign → `AssignModal`), dispatched per row kind to the existing actions — a lead through `assignLeadsBulk` / `reassignLeadManual`, a row in a manager's Data Bank through `promoteDataBankRecords` (to an employee) or `assignRecordsToManager` (to another manager). The reassign list is wider for HR than the promote list (`canAssignLeadTo` vs `resolveAssignee`), and never offers "Myself". Both lead actions now refuse a lead that is not on a Sales manager's team (`mayReassign`) — the screens never offered one, the server did not check. Moving a row mirror → mirror takes it off the old mirror's `handedInCount` instead of adding to its `handedOffCount`, or `cleanupEmptyMirror` would return it to the origin twice.
- **One number, one lead per folder — including numbers it has already handed out.** A promoted row leaves the folder, so the old per-folder check forgot the number and a re-imported sheet put the same client in the pipeline twice (8 numbers in FAISAL TOWN 2 LEADS). Add, edit, import, promote and bulk promote now also ask `leads.phoneKey` within the folder's scope (`assignedPhoneHolders`). Scope stays **per folder** at the owner's instruction — two sheets may still hold one number. Promotion writes `phoneKey` onto the lead; `npm run backfill:lead-phone-keys` filled older leads (run 2026-09-13, 119 written).
- **An employee may add a personal lead** (`addPersonalLead`, `PersonalLeadModal`, the employee leads screen on both widths): name + number + one of the **admin's own** folders (never a manager's or a mirror). It is their lead at once — ACCEPTED, `personalLead: true`, on their manager's team — and appears in that folder's Assigned list under their name. **No record row is written.** The folder list the employee sees is names only (`listPersonalLeadFolders`), and a duplicate refusal names nobody (`personalDuplicateMessage`). Admin and the employee's manager are notified.
- **A lead in a Meta campaign's folder counts in that campaign** (owner, 2026-09-17), however it got there — the lane, a hand promotion, or an employee's personal lead. `campaignForFolderLead` stamps `campaignId`/`campaignName`: the record's own `metaCampaignId` first (exact, and it survives a manager's mirror, which carries no `metaSource`), else the folder's when its basis is `CAMPAIGN`. An ad or form folder names no campaign and none is invented. The Campaigns screen attributes by the lead's own campaign and the folder's Assigned list by `dataBankFolderId`, so without this a hand-added lead read 2 in the folder and 1 on Campaigns.
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

0. **The phone's account sheet mirrors the desktop sidebar, section for section** (`MobileAccount`, 2026-09-17) — every destination in `GlobalLayout`'s menu for a role is reachable on the phone, HR's extra items included. The centre button is a **menu** for the admin (Data Bank, Meta Ads) and a manager (My Sources, Meta Ads, Meta Leads), and Meta Leads for an employee. Checked mechanically: every `path` in the three menus has a `page.tsx`, and no desktop destination is missing from the phone.
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
FOR CHANGES IN THE CODE
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
- **`position: fixed` is broken on every page in this app** — the shell wraps each one in `.animate-page-transition`, whose `will-change: transform` makes it the containing block for `fixed` descendants. A "floating" button then drifts with the page instead of the viewport. Portal it, or use `position: sticky` against the scrolling column, which is also the only option that respects the phone's tab bar — that bar is a flow row after the scroll area, so a viewport-fixed control lands on top of it. The committee FAB had both faults at once.
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

**A capped read is a silent lie about the data**
- `useLeads` holds the newest `LEAD_PAGE_SIZE` leads and nothing else, and **every screen that answers a question *about* a lead answers it from that array**. A lead outside the window does not read as old, it reads as **absent**. Client folders were where it bit: a folder shows the members still assigned to its owner, and `assignee` is built from those rows, so a member older than the window was dropped from the folder *and* from its count. Measured 2026-09-23 — `leads` crossed 500 on **2026-09-21** and stood at 536; the admin's "Personal Clients" folder held 34 rows, all 34 still assigned to the admin, **none deleted and none reassigned**, and the screen showed **14**.
- **The cap was doing its job; what it never did was say so.** That is the whole bug class: a `limit()` that silently truncates is indistinguishable from data loss, and it is reported as data loss. `useLeads` now returns **`truncated`** (the window came back full), surfaced by `LeadWindowNotice` on the leads workspace, the Clients grid and the phone's Clients screen.
- **The size is now derived, not chosen** (2026-09-24). `leadWindowSize` takes the collection's own count (`lib/liveCount`, one shared read per admin/HR device per half hour, whole pipeline only) plus 25%, rounded to 500, floored at `LEAD_WINDOW_FLOOR` 2000 and capped at `LEAD_WINDOW_CEILING` 6000. A constant was a promise somebody had to remember to renew. A count that fails, arrives late or reads junk leaves the window at the floor — it can only ever make it bigger, never smaller or later, so nothing waits on it and nothing breaks without it.
- **The ceiling is a circuit breaker, not a limit, and the reason is the browser rather than the read bill.** `onSnapshot` keeps every matched document in memory and republishes the whole array on any change, and the leads workspace filters, searches, sorts and paginates that array in JavaScript — on a phone as well as a laptop. That cliff arrives well before the cost of the reads does. Past the ceiling `truncated` is the answer and the notice asks for server-side paging, which is the one thing a bigger number cannot substitute for.
- **The size is part of the `leadSync` key, deliberately.** `leadSync` stores its watermark under that key, so a size it has not seen has no meta and `planSync` returns FULL — which is right, because the device's cached copy holds the *old, smaller* window and a delta on top of it would leave the admin reading 2000 leads while the window had grown. Growing therefore costs one full sync per device per step: about one every twenty days at ~25 leads a day, against the six-hourly full sync that already happens.
- **A Client folder no longer depends on the window at all** (`useLeadsByIds`). A folder's contents are its membership rows, so the leads the window lacks are fetched by the ids the folder already knows — batched 30 per `in` query, a manager's carrying `subAdminUid == me` so the rule can prove it, and **non-fatal**: a refused batch leaves the folder showing what the window holds, which is what it did before. Below the ceiling `missingFromWindow` is empty and it opens no listener. It is deliberately **not** used for the whole Clients section at once — one folder is capped at 300 members, the section is unbounded, and there the notice stands.

**React, and the shapes that look right**
- **Read `event.target.value` before the first `await`, never after.** A controlled `<select>` is re-rendered back to its prop the moment the handler yields, so `async () => act(await getIdToken(), …, e.target.value)` reads the **old** value — the server is asked for the status the lead already has, returns without writing, and the control snaps back. No error, nothing in the log, and it looks exactly like a dead dropdown. The phone's Pipeline Status had this; the desktop's did not, because it passed the value in synchronously.

**This project's conventions**
- The lint rule rejects `setState` in an effect body and impure calls (`Date.now()`) in a render body. Reset-during-render, or a `useCallback` registered from a browser event — not an effect.
- The raw `--experimental-strip-types` test loader cannot resolve extensionless imports — a module under test must not import `./dates`.
- **Recurring bug class: a field typed on a hook's interface but never read out of the snapshot.** It has now shipped **ten** times (`phone`/`joinedAt`/`notes`/`autoAssign`, `monthlySalary`, the payroll fields, the client-folder fields, `managerKind`, and `paidAmount`/`paymentStatus` in `useOfficeExpenses`). Check the mapper, not just the type. **The symptom is never an error** — it is a screen confidently showing the field's default, which is why it survives typecheck, lint, build and clicking around. The 2026-09-10 outing is the clearest case: the server wrote `paidAmount` correctly on every payment and the screen read a hard 0, so paying an expense appeared to do nothing.
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
- ~~`/api/cron/mark-absentees` and `/api/cron/recalculate-priorities` need
  `CRON_SECRET` — currently empty, so both cron routes refuse to run.~~
  **Stale as of 2026-09-14**: probed live, the deployment answers `401`, not the
  `503` a missing secret produces, so `CRON_SECRET` **is** set on Vercel. Fail
  closed is why the two are distinguishable — use that probe rather than reading
  `.env.local`, which is a different environment.
- **The 5-minute accept sweep runs from Railway**, not Vercel — see
  `ops/lead-cron/`. Vercel's Hobby plan caps crons at one run a day, which is
  useless for a 5-minute window. Vercel still runs `process-deadlines` nightly
  as an idempotent backstop, plus the two genuinely daily jobs.

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

### 2026-09-25 (night) — quiet hours until noon, a held morning lane · TEMPORARY, remove after 2026-09-26 12:00

Reads were at 46k of the free 50k with ~15 hours to the reset, and Blaze could not be enabled (Google refuses the billing profile, `OR_BACR2_59` — a support form, not code). Owner's instructions: nothing on screen may say so; attendance must work; no lead popups until 11:00 (moved from 10:40), then one or two at a time; normal from 12:00.

- **Quiet hours** (`meteredFirestore`, `QUIET_UNTIL` = 2026-09-26 12:00 Karachi): every client listener answers **once** from the device's IndexedDB copy, and reads the server only when the device holds nothing for that query; `getDocs`/`getDoc` the same; `getCountFromServer` refuses (the lead window stays at its floor). `onSnapshotLive` keeps two listeners live: the new-lead offer (`leads:offered:*` in `liveCollection`) and the person's own attendance (`useAttendance`). A tab still open at noon reloads the next time it is shown. Server Actions, the cron and the webhooks are unchanged — writes and intake work throughout.
- **The morning hold** (`LANE_HOLD_UNTIL` = 2026-09-26 11:00, `lib/distribution`): an offer made from the evening of the 25th until 11:00 gets `acceptDeadlineAt` = its slot + the window, the slot being 11:00 plus 0–20 minutes in four-minute steps chosen by the lead id (`holdSlot`), so nothing expires or cascades overnight and the backlog reaches people one or two at a time. `useIncomingLead` opens no listener before 11:00 and shows an offer only once `offerOpensAt` has passed. Every `acceptDeadlineFrom` / `acceptWindowPhrase` caller now passes the lead id. **The deadline sweep returns before any read until 11:00** (`skipped: 'MORNING_HOLD'`) — nothing can expire before then; leads in the admin queue wait with it.
- **Owed after noon on the 26th:** delete `QUIET_UNTIL`/`quietAnswer`/`onSnapshotLive`'s purpose (or keep `onSnapshotLive` as a plain alias), `LANE_HOLD_*`/`holdSlot`, the popup's `holdOver`, and the `__quietHoursOff` test flag. All of it is inert after its date, so leaving it costs nothing but reading time.
- **Validation**: typecheck 0, `test` 852/852 (2 new on the hold), `test:sync` 15/15 (1 new: in quiet hours a listener answers once from the device copy, counts no server read and receives no live update), `eslint src` 7 / 33, `next build` compiles.


### 2026-09-24 (small hours) — a short server-side cache for what every request reads

`lib/server/serverCache`: an in-memory, per-instance cache with a time limit, one shared load for simultaneous callers, and failures never remembered. Used **only for reads that decide what to show or who is asking — never inside a transaction**, where a stale value could write something wrong.

- **What it holds:** the caller's profile in `verifyAuth` (**30 s** — it was one read on every Server Action), the attendance policy (60 s, every check-in and home load), both expense-category lists (60 s), Reports' roster (`roster:everyone`, 60 s), `config/activityTotals` (10 min).
- **Dropped by the write itself.** The `WriteBatch` wrapper that stamps leads (`lib/server/leadStampInstall`) calls `noteWrite` for every create, set, update and delete, and again after `_commit` — where both `commit()` and a transaction finish — so a read between queueing and committing cannot re-cache the old value. A profile write also drops every `roster:` key. Other warm instances hold theirs until the window ends: **disabling an account takes effect everywhere within 30 seconds.**
- **Validation**: typecheck 0, `test` 818/818 (5 new, `serverCache.test.ts`), `eslint src` 7 / 33, `next build` compiles, `npm run test:sync` **14/14** — the new case writes a cached profile plainly and in a transaction, and a roster through a profile write, against the emulator.

### 2026-09-23 (late night) — a read meter that costs nothing and nobody sees

*"adding reads meter … dont show it to ui … read meter should show real reads and … not take its own reads."* The owner is certain the reads spike at particular times; three rounds of optimisation had been reasoned from the code, never measured.

- **Server (exact):** `lib/server/readMeter` wraps the five firebase-admin read entry points — `Query.get`, `AggregateQuery.get` (reached through a never-sent `count()`), `Firestore.getAll` (which `DocumentReference.get` uses), `Transaction.get`, `Transaction.getAll` — which do not call one another, so each read counts once. An empty query counts 1, a count 1 per 1,000. Attributed by `AsyncLocalStorage`: `runAction` labels `action:<name>`, and the cron and webhook handlers are wrapped `cron:*` / `webhook:*`. One `[readmeter]` line per scope in the server log. **`Transaction.get` tells a document from a query by class** — a `CollectionReference` has a `path` too, and was first counted as one document.
- **Browser (close):** `lib/firebase/meteredFirestore` exports `onSnapshot` / `getDocs` / `getDoc` with the SDK's own signatures; the 20 client files that read import them from there. It counts documents **from the server** only — first answer in full (`initial`, an over-count when a listen resumes within 30 min), later answers by changed documents (`update`), gets by size. **Query listeners are opened with metadata changes on** so the server's silent, billed re-send of an unchanged result is counted; only what the screen would have received is passed on. Tallied in memory, sent every five minutes and on tab hide by `sendBeacon` to `/api/readmeter`, which only logs. **No Firestore read or write anywhere in the meter.**
- **Found by building it:** `lib/leadSync` recorded its "device is current" marker only on a server answer, and an unchanged result raises no ordinary event — so the marker was rarely written and most reopens would have synced in full. Both its listeners now take metadata changes.
- **Collected from here**: `node scripts/readmeter-collect.mjs` pulls the lines every 20 minutes into `.readmeter/log.jsonl` (gitignored) — Vercel Hobby keeps about an hour — and `scripts/readmeter-report.mjs [day]` prints reads by hour, by source and by person.
- **Validation**: typecheck 0, `test` 813/813, `eslint src` 7 / 33 (baseline), `next build` compiles, **`npm run test:sync` 13/13** (4 sync, 6 server meter, 3 browser meter against the real client SDK). The emulator needs `firebase-tools@13` here, and a test run killed mid-way leaves the emulator's Java on port 8080.

### 2026-09-23 (night) — Reports from day totals; the sweep reads the team once

*"Do 1 2 3 4"* — the four remaining read cuts: day totals for Reports, a ten-minute report memory, Reports opening on Today, and the sweep sharing one roster read. Rules under **KPI** (Reports) and **Distribution**.

- **The sweep reads the rotation once per run** (`RosterShare`, `lib/server/laneRoster`), outside the transactions, for every lead it moves — at 09:05 the night's offers expire together. A folder restricted to chosen people keeps its own small `getAll`. The daily reminder's `cronState` marker is remembered by a warm instance (`sweptDayInMemory`) instead of read 288 times a day.
- **Offers made at night say so**: `acceptWindowPhrase` ends the notification "You can accept it until 09:05." instead of "5 minutes".
- **Owed tomorrow, with quota to spare:** `npm run backfill:activity-days` (dry run), then `-- --confirm`. Until then Reports is exactly as before for days up to the 23rd.
- **Validation**: typecheck 0, `test` **813/813**, `eslint src` 7 / 33 (baseline), `next build` compiles, `npm run test:sync` 4/4. The `activityDays` index is deployed and READY. **Not run against live data** — the project was over its read quota.

### 2026-09-23 (late evening) — only what changed: the lead list stops re-downloading itself

*"do every technique and make it optimized then test it as well and make sure it wont happen again."*

- **Every server write to `leads/{id}` is stamped `updatedAt`, centrally** (`lib/leadStamp` + `lib/server/leadStampInstall`, installed in `getAdminDb`). It wraps `WriteBatch.prototype`, which `DocumentReference`, `Transaction` and `BulkWriter` all write through, so the ~60 lead writers — and any added later — are stamped without knowing it. Complete because browsers cannot write `leads` and the app never deletes one. Scripts that initialise their own firebase-admin are **not** stamped; the six-hour full sync covers them.
- **The admin's and HR's whole-pipeline list syncs only what changed** (`lib/leadSync`, `lib/leadSyncPlan`): the device's IndexedDB copy via `getDocsFromCache`, then `updatedAt > watermark`; a full sync if there is no copy, the copy is over six hours old, the record is corrupt, or the delta query errors. Scoped lists (employee, Sales manager) keep the ordinary listener — a lead reassigned out of their scope would never reach their delta. `useLeads` hands screens the same `LiveState` either way.
- **The lane's night** — rule under **Distribution**.
- **"Counts instead of lists" found nothing to change**: no screen loads a large list only to count it; the big lists are the ones displayed.
- **Tested end to end on the emulator** — `npm run test:sync` (4 tests, real `firestore.rules`): stamping on create/set/merge/update/transaction and not on subcollections; the delta returns only changed leads; the rules allow it for admin and HR and refuse an employee; the cache answers the full query. **The emulator needs `firebase-tools@13`** on this machine's Java 17 — current releases require Java 21.
- **`npm run test:rules` run for the first time in weeks: 37/40.** The 3 failures are all "a missing deal must read as absent" (`closedDeals`), and `firestore.rules` is unchanged since 2026-09-15 — pre-existing, not caused by this round, and owed a look.
- **Validation**: typecheck 0, `test` **806/806**, `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles. **Not measured against live usage** — the database was over quota all evening.

### 2026-09-23 (evening) — the free read quota ran out; Reports was reading the whole company's month

At ~17:15 Karachi every read began failing with `429 RESOURCE_EXHAUSTED` — the Spark plan's 50,000 reads/day. Railway's failure emails were the symptom: the sweep it calls returned 500, Railway itself was fine. The owner was advised to move to Blaze (a $30 prepayment was asked); no workaround exists, since everything reads first.

- **The largest reader found:** `loadEntries` ran `collectionGroup('followUps')` over the range **unscoped** and discarded all but the subject's entries, and Reports opens on "This month" — so every open, including an employee opening their own, read every entry the company had written since the 1st. The dossier's activity used the same query. Now scoped: entries whose `creditUid` **or** `authorUid` is a subject, unioned by path, because entries before 2026-09-03 carry only `authorUid` and are credited through it. Two collection-group indexes (`creditUid, dayKey`, `authorUid, dayKey`) deployed; until they build the per-lead fallback (already scoped) runs.
- **Also deployed:** the owed `leads (status, lastFollowUpAt)` index for the quiet-lead reminder.
- **The quota message staff see is neutral** (`QUOTA_MESSAGE`) and no screen names the plan, quota or billing — the owner's instruction. The server log still says `Firestore quota exhausted`.
- **Not changed, worth the owner's decision:** the lane loop costs ~15 reads and ~4 writes per hop, every five minutes, all night for any lead nobody accepts.
- **Not measured:** the service account cannot read Cloud Monitoring (403), and Vercel's log window is about an hour, so the read budget was traced from the code, not from usage figures.

### 2026-09-23 (second round) — Investment with X: profit is income only once it is received

*"we enter amounts and profits are calculated but in originality we havent recieved the payment yet so there should be option on which i click recieved and that profit goes to income and the investment amount goes back."*

Rule under **Money → Investment with X**. Measured first, read-only: 8 live rounds, every one with a return date, so every one had banked its net into *Investment with X* (537,600) and returned its capital at save time — six of them with return dates from 2026-09-26 to 2026-10-09.

- **One ledger writer for both paths.** `readRoundLedger` / `writeRoundLedger` do the capital legs, the income row and every balance in **one transaction**, used by the round form and by the Received button alike. The net used to be written outside the transaction by a second function; it is now inside it, so a half-saved round cannot bank a profit its row does not show.
- **The screen:** a Received column on the sheet (a button — *Awaiting · Mark received*, *Overdue* in red past the return date, *Received {date}* once done), the same as a pill and an action on the phone, a received date asked for on confirmation, a Received tick on the form, and a **Net Received** card showing what is still to come.
- **Left for the owner, deliberately:** the 8 existing rounds still read received. Flipping the six future ones would move 404,600 of net out of the income account and put capital back out on four accounts; that is a live write about which rounds were actually paid, not something to guess.
- **Validation**: typecheck 0 errors, `test` **789/789** (783 → 789), `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles. **Not driven in a browser or against the live project** — the ledger arithmetic is covered by the unit tests, the transaction path by typecheck only.

### 2026-09-24 — the lead window sizes itself, and a Client folder stops depending on it

*"so can we make the limit dynamic like not hard cap?"*

Yes to dynamic; **no to uncapped**, and the reason is worth keeping: past a few thousand leads the binding constraint is not Firestore's bill but the browser — `onSnapshot` holds every matched document in memory and republishes the whole array on any change, and the workspace filters, searches and sorts that array in JavaScript. Rules under **Lessons → A capped read is a silent lie about the data**.

- **`lib/leadWindow`** (pure, 10 tests) turns a count into a window: count × 1.25, rounded to 500, floored at 2000, capped at 6000. **`lib/liveCount`** shares one `getCountFromServer` per key with a 30-minute TTL and an in-flight guard, so four components asking `useLeads` on one page cost one read — and only the whole pipeline is counted, never a per-employee scope that cannot approach the floor.
- **Its failure had to be invisible, and is.** A refused, exhausted or offline count leaves the window at the floor. This is the one place where being wrong quietly is correct: the count is an optimisation, and a screen must not wait on a number it does not need.
- **Found while building, and it changed the work:** the repo had moved on five commits, including `lib/leadSync` — built the same day the free read quota ran out at 17:15 — which serves the admin's pipeline from an IndexedDB copy plus `updatedAt > watermark`, full-syncing every six hours. That changes the economics (a bigger window is no longer billed per page load) *and* adds a correctness trap: the cached copy holds the old window, so growing the size must force a FULL sync. Putting the size in the sync key does exactly that, because `readSyncMeta` finds no meta for a key it has not seen.
- **`useLeadsByIds`** is the half that outlives any cap: a Client folder fetches the members the window lacks by id, so the folder is correct whatever the pipeline's size. Normally it opens nothing.
- **Validation**: typecheck 0 errors, `test` **828/828** (818 → 828, all on the window arithmetic: an unknown count falling to the floor rather than zero, the step boundary at 1600/1601, a clamped-but-still-complete window at 5000, full-and-reported past the ceiling, dedupe and ordering of missing ids, and batches never exceeding the `in` limit), `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles all 82 routes.

  **Not verified against the live project: the daily read quota is exhausted again** — `count()` came back `429 RESOURCE_EXHAUSTED` in under a second (`preferRest` doing its job). So the derived size for the real collection, and the proof that the folder still reads 34, are **unverified**. Re-run after the quota resets at midnight Pacific: the count was 537 yesterday, which puts the window at the 2000 floor and `missingFromWindow` at empty, so the expectation is that nothing changes on screen and no by-id listener opens. **Not driven in a browser.**

### 2026-09-23 — 34 clients became 14, and nothing had been deleted

*"in his personal clients folder there were 34 clients now only 14 its very important and confidential."*

**Nothing was lost.** Measured against the live project before changing a line: the folder held **34 membership rows**, all **34** leads still assigned to the admin, **0 deleted**, **0 reassigned**. The screen could only see 14 of them.

`useLeads` reads `orderBy('createdAt','desc').limit(500)`, and a Client folder's visible leads are its members intersected with *that array* (`useOwnClientLeads` → `countOwnClientLeads`). The `leads` collection crossed 500 on **2026-09-21** and stood at 536, so the 36 oldest leads stopped being loaded — and 20 of them were in that folder. A lead outside the window does not read as old; it reads as assigned to nobody, which is the one thing that removes it from a Client folder.

- **Yesterday's pushes are not the cause.** The collection crossed the cap the day *before* them, and none of the five commits touches `useLeads`, `useClients` or `clientFolderScope`. It is volume, and the intake the lane and the WhatsApp bridge now feed is why volume moved.
- **Fixed at the cap, not at the symptom**, because the same window truncates the admin's leads workspace, dashboard and every dossier count — Clients is only where it was visible. 500 → **2000**, which restores the folder to 34/34 and covers the whole 537-lead pipeline. `persistentLocalCache` is already wired, so the extra reads are paid once per cold session, not per navigation.
- **The flag is the part that matters.** `useLeads` now returns `truncated`, and `LeadWindowNotice` says so on the leads workspace, the Clients grid and the phone. A number that is quietly short reads as deleted data; this is the difference between an incident and a sentence on a screen.
- **Not a bug, and worth saying before it is reported as one:** the admin's *Faisal town 2 Gulf* shows **4** of 43 rows, ESMR shows 6 of 7. Those leads were reassigned to employees, and a Client folder deliberately shows only what is still the owner's (rule under **Data Bank & Clients**, measured the same way on 2026-09-13). The membership rows are kept, so reassigning one back restores it.
- **Validation**: typecheck 0 errors, `test` **783/783**, `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles every route. The before-and-after was **measured against the live project read-only** — 20 hidden before, **0 hidden after**, across all 12 Client folders. No writes; the probe script was deleted.
- **Owed: this is local only.** The client keeps seeing 14 until the commit is pushed and Vercel redeploys.

### 2026-09-22 (fifth round) — the lane loops instead of forcing the last person to accept

*"if the 5 min window passes it moves to next one and the last one is force accept dont do that … if she is the last employe in quee it should move back to the first one."*

Rule under **Distribution**. `resolveCascadeAssignee` returns `wrapped` in place of `forced`, and all three callers — the cron sweep, Pass on and the demo store — replace `attemptedAssignees` with the new holder on a wrap, because adding to it would leave the whole roster excluded and the next pass with nobody to go to. No path writes `ACCEPTED` on a cascade any more; every hop is an offer with a fresh five-minute window.

- **The loop forces a second change, and it is the one worth reading.** With no end to the lane, the same person can let the same lead lapse every five minutes. A red flag per hop would bury the panel and turn `missedLeadsCount` into a measure of how long a lead went unclaimed; so a miss is flagged and charged **once per person per lead** (`missedAssignees`), while the `EXPIRED` event is still written every time and `cascadeLap` counts the laps. Accountability kept, spam not.
- **Stated plainly because the owner should decide it, not me:** an unaccepted lead now circles for ever. At the five-minute sweep that is ~288 hops a day — roughly 860 writes for a single stuck lead against a 20,000/day cap. Five of them is a fifth of the day's budget. A cap ("after N laps, park it for the admin") is a one-line change if that is wanted.
- **A one-person lane re-offers to the same person** rather than forcing it on them, which is the instruction taken literally.
- `UNASSIGNED_NO_CAPACITY` is now only reachable with nobody active in the lane at all.
- **Found while doing it:** three screens labelled the `FORCE_ACCEPTED` audit event "Force-accepted — end of priority lane". The lane's floor was never its only writer — an admin promoting a record has always written it — so the label was already wrong for the commonest case and would have been wholly wrong now. Relabelled "Accepted on assignment — handed out by an admin".
- **Validation**: typecheck 0 errors, `test` **783/783** (782 → 783; the four floor tests became loop tests, plus a seven-expiry walk proving two full laps and a third hop), `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles and finishes TypeScript. **Not driven in a browser or against the live project** — no `.env.local` on this machine.

### 2026-09-22 (fourth round) — the Data Bank stops listing campaigns, the admin's bell gets five types, and a quiet lead reminds its owner

Three instructions in one round; the rules are under **Data Bank & Clients** and the new **Alerts** section.

**1 · Meta folders left the Data Bank grid.** One predicate, in the hook, so the Data Bank and Meta Ads cannot disagree about which screen owns a folder. The folders themselves, their records and their URLs are unchanged, and the Data Bank header now links to the campaigns rather than leaving somebody hunting for a folder that "disappeared".

**2 · The admin's panel became an allow-list of five.** Filtered after the read rather than in the query, because the index a `type in [...]` clause needs cannot be deployed from here and a missing index empties the bell. Two new alerts were needed to satisfy the list — an on-time check-in and a lead climbing into P2/P1 — and *climbing* is the word: `stageRank` makes Token Received → Deal Closed silent.

**Found while doing it:** `markAllNotificationsRead` cleared **every** unread row in the collection, not the admin's. An admin pressing "Mark all as read" was silently emptying the bells of seven employees who had never opened them. Scoped, on both the real path and the demo one.

**3 · The stale-lead sweep changed recipient, not just interval.** It ran at 24 hours and told the admin; it now runs at 7 days and tells whoever holds the lead, which is the only person who can act on it. Leads never contacted are excluded — a first call is the lane's job, not a forgotten one. `noFollowUpHours` is retired rather than reinterpreted, and Settings now reads days.

- **Validation**: typecheck 0 errors, `test` **782/782** (775 → 782), `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles and finishes TypeScript. **Not driven in a browser or against the live project** — no `.env.local` on this machine.
- **Owed:** `npm run deploy:indexes` for the new `leads (status, lastFollowUpAt)` index. Until it lands the reminder runs its `lastActivityAt` fallback and says so in the log — it works, it just cannot see a lead whose status moved recently without anybody ringing the client.
- **The admin should press "Mark all as read" once**, which is what clears the backlog of types the panel no longer shows. It clears up to 400 rows per press.

### 2026-09-22 (third round) — Meeting Aligned, from the entry form to the report

*"add an option meeting alligned in remarks follow up section and also show in the directory → team → employee … along with follow ups remarks connected calls."*

Rule under **Leads**. One classification (`entryTally`) feeding three screens, which is the whole reason the dossier and Reports can be checked against each other — a second counting rule for this would be the 2026-09-09 bug again, where the dossier read 7 connects on a day with 3.

- **Its own figure, not a slice of the connects.** A call answered and a call that produced an appointment are different outcomes. It is not disjoint from Remarks and Follow-ups — the same entry is counted in both — exactly as the connect columns are not, and the test says so.
- **In *Activity in range*, beside the calls that produced it**, with Meetings (held) left in *Outcome*. A row reading 9 aligned and 2 held is a diary that is not converting, which is what makes the pair worth printing.
- **Four toggles do not fit one 390px row**, so the phone's entry sheet wraps rather than shrinking the targets.
- Editing the newest entry moves `meetingAlignedCount` by the delta like every other counter; the lead-level flag stays one-way, since a later entry that does not mention a meeting is not evidence one was cancelled.
- **Validation**: typecheck 0 errors, `test` **775/775** (769 → 775), `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles and finishes TypeScript. **Not driven in a browser** — no `.env.local` on this machine.

### 2026-09-22 (second round) — Office Expenses gets a subject

*"in the office expense there should be option a filter of mine and tayyab ali … in mine i see all mine and all the numbers should also change."*

**Recorded by**, on the desktop filter row and as its own chip row on the phone. Rule under **Money**. The decision worth recording is that this is a **subject and not a cut** — it moves the hero, the stat cards, both charts, the export and *Pay period total*, where status and category deliberately leave the headline alone. Both readings are defensible and the owner asked for the totals to move; the screen now says whose they are, in the eyebrow and the caption, because a part read as the whole is exactly what a person carries into a meeting.

- The options are derived from the expenses, so the list is what can usefully be picked; names come from the manager roster with the expense's stored email as the fallback, so somebody who has left is still named rather than appearing as a uid.
- **Records with no `addedByUid` are gathered under "Not recorded"** rather than left out — omitted, they would still count under Everyone and the per-person figures would quietly fail to reconcile.
- *Pay period total* now names the subject in its label, since with one person selected it pays their approved expenses only.
- **HR could not reach Office Expenses from the phone's Money tab at all** — found while checking Tayyab's side of this. The hub (`MoneyHub`) listed a manager's earnings, salary and team and stopped there, while the desktop sidebar and the phone's account sheet both carry HR's Salary / Payroll and Office Expenses. The Money tab is one of the phone's five slots and exists precisely so nobody has to remember where the money side lives, so HR's two daily screens were the two you could only reach the long way round. Both added, in the sidebar's order and with its labels. The screen itself was already correct for HR: their read is scoped to their own rows, Approve / Reject / Delete are absent, Edit refuses somebody else's on the server, and paying is allowed (`requireFinance` accepts HR).
- **The phone gets its own labelled row**, above the status/category chips — a second unlabelled chip row would read as one more way to filter the list, and the phone has none of the desktop's field labels to say otherwise. The subject stays out of the **mobile** eyebrow and lives in the caption: at 10.5px uppercase, `OFFICE EXPENSES · TAYYAB ALI` wraps to two lines on a 390px screen and pushes the figure down.
- **Validation**: typecheck 0 errors, `test` **769/769** (764 → 769), `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles and finishes TypeScript. **Not driven in a browser** — no `.env.local` on this machine.

### 2026-09-22 — a campaign's leads can belong to particular people

*"add an option on the folder … he wants to give all the esmr leads to only specific employes … it can be one or multiple and also managers and himself admin is also included."*

**Who gets these leads**, on every Meta Ads card. Rule under **Distribution**; the owner chose all four defaults when asked — rotate within the chosen group on the lane's own rules, keep the lead inside the group rather than letting it escape, the admin takes their turn on the same terms as everybody else, and manual promotion stays unrestricted. (The group's *floor* became a *loop* later the same day; see the fifth round.)

- **One roster reader, `lib/server/laneRoster.ts`.** The Meta intake, the cron cascade and Pass on each built their own; this project has already paid for that once, when one of the three copies stopped reading `autoAssign` and four employees marked out of distribution kept receiving leads. The restriction is applied in the one place all three now ask.
- **Found while building, and it would have been the feature's worst failure:** `useIncomingLead` is gated to employees and rotation managers, so an admin who put themselves on a folder would have been given a lead with a five-minute clock and **no popup anywhere in the app** — a silent lapse, a red flag against themselves, and the lead handed to somebody else. The admin now runs the same query; nothing else reaches it, because only a lane offer is ever `ASSIGNED`.
- **`laneUids` is read out of the folder snapshot as well as typed** (`useDataBank.folderFrom`) — the eleventh chance at this project's most-repeated bug, whose symptom here would have been every card reading "goes to everyone in the rotation" while the server routed to three people.
- **Validation**: typecheck 0 errors, `test` **764/764** (756 → 764: the empty-means-everyone cases, dedupe and the cap, chosen-beats-`autoAssign`, paused-is-still-skipped, the admin sorting to the back of a group, and the group's rotation and floor), `eslint src` 7 errors / 33 warnings (baseline, none in the new files), `next build` compiles and finishes TypeScript.

  **Not driven in a browser and not exercised against the live project** — this machine has **no `.env.local`**, so the build stops at prerender with `auth/invalid-api-key` (the 2026-09-16 condition, unrelated to this change), no Admin SDK probe was possible, and no signed-in session exists. The screens are reasoned from the shared components; the routing rules are proven by the unit tests above. Worth one pass end to end — restrict a campaign folder, submit a test lead, let the window lapse once — before relying on it.

### 2026-09-18 — the attendance calendar, transcribed from its design file

*"in this folder i have ui for attendence calender change the ui to exactly like this."* `Attendance Calendar.dc.html` (now copied into `docs/design/`) is transcribed into `attendanceChrome` (`ATTENDANCE_TONES`, `StatusLegend`, `AttendanceCalendar`, new `CalendarPanel` + `CalendarPersonPicker`), `AttendanceNav` (the segmented #dceae8 strip) and `AttendanceShell` (the file's 22/28/34 padding, 16px under the strip). Rule under **Attendance**. The file's top bar and 96px rail are the app's shell and were not reproduced.

- **Values copied, then checked by script**: 64 values from the file — the whole status table, every frame colour, both shadows, the six SVG paths, every padding, radius and type size — all present in the source.
- **Whole team** keeps its matrix inside the new card, with today's column marked in the file's teal circle.
- **Validation**: typecheck 0, `test` 756/756, `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles all 17 attendance routes. **Not seen rendered** — the Chrome extension was not connected.

### 2026-09-17 — WhatsApp ads reach the CRM, grouped by campaign, ads only

*"if a person send that message it will show up in crm with the name number and also the source … folder of faisal town 2 … i only want the leads that came through ads."*

**Why nothing arrived, measured rather than guessed:** the number was already on the Cloud API via Coexistence (`platform_type: CLOUD_API`, `is_on_biz_app: true`), but `GET /{WABA}/subscribed_apps` was **empty** — no app received its messages, so Make's trigger never fired. Creating the webhook in Make's WhatsApp module subscribed **"Make for Business Messaging"** and the first message arrived at once. Make's WhatsApp connection is now a Meta sign-in with a *Regular / Coexistence* choice, not a pasted token — its help page is out of date. The `Mahziyar Leads CRM` app and its system-user token (WhatsApp scopes) were made on the way; they are what the diagnosis ran on, not what Make uses.

- **Ads only** — `cameFromAnAd` now gates filing, before any read.
- **Grouped by campaign** — `whatsappSource` + `resolveCampaign`, which now prefers `META_ADS_ACCESS_TOKEN` and times out at 8s. **The CRM's Page token cannot reach the business's ad accounts** (`owned_ad_accounts` → `Unsupported get request`), so until that variable is set on Vercel, WhatsApp leads group by ad and the response says `groupedBy: "AD"`.
- **The Make body omits `message`** for now: a first message with a line break or a quote makes Make's JSON-string body invalid, and the lead would be refused as `Malformed payload`.
- **Validation**: typecheck 0 errors, `test` **742/742** (4 new), eslint clean on the changed files.

**Late evening — Meta Leads and the phone, made to match.** *"add all the options in the mobile view … if i click on databank it should give option like databank or meta … meta leads … exactly like shown in admin … employee should not be able to reassign … check every thing."* Rules under **Distribution** and **Hard UI rules** (0). Found while checking: the admin's phone menu had no Meta Ads and none of the twelve Accounts modules, carried two retired links (Income Sheet, the old Investments), and HR managers had no payroll, expenses or attendance settings on the phone; the manager's desktop menu had no Meta Ads; the Meta Ads screen's "Open" alert link was hard-coded to `/admin` (a 404 for a manager); and it bled 24px on a phone the shell pads by 16, scrolling sideways; the employee centre button drew the Data Bank icon. Validation: typecheck 0, `test` **756/756** (5 new), `eslint src` 7 errors / 33 warnings (baseline), `next build` compiles every Meta route including the two new `[folderId]` pages; 60 menu paths all resolve; the card grouping replayed on live leads (Sundus FASAL TOWN 2 ×6, Aroosa FASAL TOWN 2 ×2 + a lead form ×1, Rafia ×1, managers none). **Not driven in a browser** — Chrome was not connected.

**Evening — the lane becomes the admin's to run.** *"admin should have the option to choose who are in rotation … how many leads a person gets … manager should be in the priority … admin can lock the priority."* Owner's answers: a number **per person, per turn**, and a manager in rotation is offered leads **exactly like an employee**. Rules under **Distribution**. Found on the way: the cascade and Pass on never re-stamped `subAdminUid`, so a lead that moved between teams stayed filed under the first person's manager — harmless while everyone sat under the admin, fatal the moment a manager is a recipient. Also shipped earlier that evening: `LEADS_PER_TURN` 5 → 1, confirmed live by the lane screen's wording in the production bundle. Validation: typecheck 0, `test` **751/751** (4 new), eslint clean on the changed files; the new roster and ranking queries run against the live project (7 people, both managers `autoAssign: false`). **Not driven in a browser.**

**Later the same day — proven with real customers, and three findings.**

- **It works end to end.** Awais Khan tapped FASAL TOWN 2 – Pakistan at 14:34 Karachi and landed in `meta_campaign_120251649751890457` as `META_ADS`, offered to Aroosa (priority 1). She let the window lapse; the Railway sweep moved it to Rafia at 14:40 and Rafia accepted at 14:44 — the lane exactly as specified. So Make does pass `referral` through, and `META_ADS_ACCESS_TOKEN` is live on Vercel.
- **The campaign lookup needed the ad account in the business.** The FASAL TOWN 2 ads ran from a *personal* ad account (`act_6005303459583962`, under "Other assets"); a system-user token only sees accounts inside the portfolio, and Graph answered `(#200) Ad account owner has NOT grant ads_read`. The owner claimed it into Mahziyar Marketing official (permanent, checked against Account Quality first) and assigned `crm-leads` View performance. No new token or redeploy was needed after that.
- **4 of the 7 active WhatsApp ads send to Maysam's number, not the CRM's.** Read off each ad set's `promoted_object.whatsapp_phone_number`: FASAL TOWN 2 and two boosted posts → `923111555426`; four boosted posts → `923125772180`, which is not on the Cloud API and never reaches Make. The Page has both numbers, Maysam's as **primary** — which is why opening an ad *as a post* (`source=FB_Post`) opens his chat; a paid impression uses the ad set's number. Switching those ad sets, or putting his number on Coexistence, is the owner's call. Setting 0311 as the Page's primary failed ("couldn't be set as your primary account").
- **Two fixes shipped from what the trace showed**: the stale `assigneeName` after a cascade (rule under **Distribution**), and a hand-added lead in a campaign folder not counting on Campaigns (rule under **Data Bank & Clients**) — Dr haroon, added by Sundus, read 2 in the folder and 1 on Campaigns. 747/747 tests (5 new); 5 names and 1 campaign repaired live.

### 2026-09-16 — Investment with X: where the round's money came from

*"where does this 407 came from … i can choose which account i want like capital investment there is investor A or m."* The round's Amount was a typed figure with no account behind it. The owner's call on the money: **out on the date, back on the return date**. Rule above under **Money**.

- The round form has a **Taken from** card: one select listing every account grouped by kind (Capital Investment first), each with its balance, and "+ Split across another account". A line summary says what will happen ("Rs 407,000 leaves Investor A on 2026-08-31 and goes back in on 2026-09-18"); a split that does not add up disables Save. The sheet gains a **From** column (and CSV column), the phone card a From figure, and *Invested* notes how much is still out.
- Group income: `isIncomeMovement` now skips `type: 'INVESTMENT'`, or the capital coming back would have been booked as income.
- **Validation**: typecheck 0 errors, `test` **738/738** (11 new: split exactness, one-account default, out/back legs, edit deltas, returned round nets to zero, capital not income), `eslint src` 7 errors / 33 warnings (unchanged). `build` compiles and passes TypeScript, then stops at prerender with `auth/invalid-api-key` because this machine has **no `.env.local`**. `npm ci` was run to get `node_modules`.

  **Not driven against the live project or in a browser**: no `.env.local` here, so no Admin SDK probe and no signed-in session.

### 2026-09-15 — Pay a period's total, Investment with X, Mahziyar Group income & expense, Receivables & Payables

Studied first: the photographed `INVESTMENT WITH X` sheet (every complete row reproduces as net = profit − shares; the last two rows were unfinished) and `MAHZIYAR DATA FOR CRM.xlsx`, whose `MAHZIYAR INCOME RECORD`, `OFFICE EXPENCE` ("Mahziyar GROUP Expense Details For The Month Of…"), `INVESTMENT`, `RECEIEVEABLES` and `PAYABLES` tabs are the specification. Owner's answers: group income = monthly performance filled from the accounts, editable, fields addable; group expense = office + personal combined per month, lines addable, closing made/spent/remaining with the incomes listed and editable; investment = only net profit moves; receivables/payables = just a sheet. Rules above, under **Money**.

- New routes `/admin/accounts/{investment-with-x,group-income,group-expense}`; `/admin/accounts/receivable` is now Receivables & Payables. Sidebar and phone hub updated; the old Income Sheet is no longer in the menu (its route still exists).
- `SheetTable` draws the owner's sheets on the desktop (pinned first column, TOTAL row); the phone gets `ExpenseList` + `FigureStrip` cards.
- **Rules deployed** for the six new collections (additive, admin + HR read, no browser writes).

- **Validation**: `typecheck` 0 errors, `test` **721/721**, `build` compiles, `eslint src` 7 errors / 33 warnings (no new ones).

  **Driven end to end against the live project** through the running dev server with a real admin token, on records dated January 2020 and a throwaway account, all deleted afterwards (expenses 28, transactions 12, accounts 5 — as found): 30,000 total paid Rent 20,000 in full and Bills 10,000 of 15,000, skipped the pending one, refused one rupee over; the sheet's row 205,000 / 35,000 / 32,000 / AARYJ 25,000 banked 10,000, an edit moved the balance by the difference, switching to Gross re-banked it, removing a used column was refused; closing Jan 2020 froze income 9,000 (edited line), office 35,000, committee 4,000, then refused editing an expense and adding a line in it while still allowing payment, and reopened; receivable 8,500 settled 3,000 → 5,500 and over-settling refused.

  **Not driven in a browser** — Chrome was on the sign-in page. **Not run:** importing the 10 legacy receivables (left for the owner's button).

### 2026-09-14 (fourth round) — the phone had no way to reach Meta Leads

*"in the mobile view there isnt any way to view meta leads add meta leads in the
middle like databank is for admin."*

Correct, and it was a real hole rather than a preference. The Meta Leads entry
went into `GlobalLayout`, which is the **desktop** shell — below 820px this app
renders a separate product with a five-slot tab bar, and none of those slots led
there. A screen that exists on one surface only is a screen half the team cannot
reach, and this is the one carrying a five-minute clock.

`EMPLOYEE_CENTRE` now points the employee's centre slot at
`/employee/meta-leads`, exactly as `ADMIN_CENTRE` points an admin's at the Data
Bank, and for the same stated reason: a **destination**, not a contextual
action, because nobody learns where a button is if it is only sometimes there.
It is listed in the phone account sheet too — a destination reachable one way
only is one people ask about.

**The cost, stated:** an employee loses the contextual *"call whoever is on the
acceptance clock"* button that used to sit in that slot. What replaces it is the
screen listing every lead on that clock, with the number, Accept and Pass on —
so the call is one tap further away rather than gone, and the slide-in popup
still carries both answers wherever they are in the app.

**Found while doing it, and left alone deliberately:** with every role now
carrying a fixed destination, `useMobileCentre` is effectively dead —
`MobileDashboard`, `MobileLeads` and `MobileEmployees` all still compute and
publish a contextual action that nothing reads. That is dead weight rather than
a bug, and ripping out the mechanism is a different change from adding this
destination. It is recorded in `MobileTabBar`'s own comment so the next person
does not spend an afternoon working out why their contextual button never
appears.

- **Validation**: `typecheck` 0 errors, `test` 695/695, `build` compiles,
  `eslint src` at the 7 pre-existing errors and 33 warnings.

  **Not driven on a phone** — Chrome tooling is not enabled for this session.

### 2026-09-14 (third round) — the lane had no source, and four of five people were not in it

*"a person enters the details in the form it comes in meta leads section in admin
pannel but also it goes to the employes meta leads section… employee is selected
based on priority and if employee accepts then it only comes other wise it is
passed down."*

**Traced before building, and the trace found two blockers.**

**1 · Nothing fed the lane.** Both Meta routes call `fileMetaLead`, which writes
`dataBankRecords` and nothing else — so a Facebook lead became a Data Bank row
and stopped. Promotion then writes `status: "ACCEPTED"` outright, because an
admin handing out a lead is a decision rather than an offer. The only thing that
ever produced an `ASSIGNED` lead with an accept window was `createLead` with
status NEW and nobody assigned — the manual Add Lead form, **which is removed
from the UI**. So the popup and the five-minute window shipped that morning had
no live path to them at all. That was the wrong order to work in: the answering
half was built before checking anything reached it.

**2 · `autoAssign` was never read, and four of five employees were marked out.**
`eligible()` filters the lane on `autoAssign !== false` and is tested, but
`readDistributionState` in the cron — the only place auto-distribution happens —
built its `Employee` objects from `uid`, `priority` and `status` alone. Every
employee therefore arrived as `undefined`, which means *in the lane*, and the
documented rule that `autoAssign: false` removes somebody from distribution
**and** the cascade silently did not exist.

Measured live: **Sundus, Aroosa, Hussain and Rafia were all `autoAssign: false`**
and all four were still receiving automatically distributed leads. Fixing the
bug alone would have narrowed the lane to one account — and a lane of one
force-accepts at the floor, so there would have been no offer, no window and no
cascade. The feature would have been correct and done nothing recognisable.
Raised before building rather than after.

**The owner's call:** Aroosa, Sundus and Rafia back into the lane, Hussain left
out, priorities by performance. Done, and re-ranked with the system's own rule
rather than by hand — this month's figures gave **Aroosa 138 (69 connects),
Sundus 34, Rafia 32**, so the lane is Aroosa → Sundus → Rafia → *(Hussain
skipped)* → maysampersonal.

**`readLaneEmployee` is the fix, and it is the mapper that is now tested.** The
mapping lives in `lib/distribution` beside the rule it feeds, with six tests
including the one that matters — somebody marked out is offered nothing — plus
the proof that only an explicit `false` removes them, so adding the field can
never empty the rotation for records predating it. **Tenth outing of this
project's most-repeated bug**; every previous fix corrected a mapper without
making one testable, which is why it kept coming back.

**Built:**
- `lib/server/metaDistribute.ts` — `offerMetaRecordToLane` and
  `fileAndOfferMetaLead`. One transaction, because the rotation counter is a
  read-modify-write and two leads arriving together would otherwise both be
  handed to the same person, which is the exact unfairness the rotation exists
  to prevent. **Offering can fail without the filing failing** — by then the
  record is safely in the Data Bank, and letting it bubble up would make the
  webhook answer non-2xx and Meta redeliver a lead already stored, which is how
  one submission becomes two rows.
- **One wrapper, two doors.** The direct webhook and the Make.com bridge both
  call `fileAndOfferMetaLead`, or the two would eventually disagree about what
  happens to a lead depending on which route Meta used.
- The lead is written `source: 'META_ADS'` with the campaign name, so
  `describeLeadSource` prints *Meta Ads (Ramadan Offer)* rather than *Data
  Bank*, and the employee's screen has something to filter on.
- `/employee/meta-leads` + `MetaLeadsView` — offers at the top with a live
  countdown, Accept and Pass on, their own Facebook leads below. **Its own nav
  entry rather than a filter on My Leads**: a thing with a five-minute clock does
  not belong behind a filter somebody has to remember to apply.
- `Lead.notes` typed — the raw rows already carried it.

- **Validation**: `typecheck` 0 errors, `test` **695/695** (689 → 695, all six on
  `readLaneEmployee`), `build` compiles including `/employee/meta-leads`,
  `eslint src` at the 7 pre-existing errors and 33 warnings — verified file by
  file that all 7 are pre-existing and none is in the new code.

  **Not driven in a browser, and not yet exercised end to end.** One un-promoted
  Meta record is sitting in the Data Bank (the owner's own test submission);
  offering it would notify a real employee, so it is the owner's to trigger.

### 2026-09-14 (second round) — the 5-minute window actually fires, from Railway

The owner has a paid Railway subscription and asked for the accept window alone
to run there. `ops/lead-cron/` is a Railway **cron service** calling
`/api/cron/process-deadlines` every five minutes. The app stays on Vercel.

**Railway's cron minimum is five minutes**, which is exactly the interval this
needs and the reason it is the right host for it. Vercel's Hobby plan allows one
run a day, so the countdown reached 0:00 and the lead sat with the person who
never answered until 01:00 UTC.

**It holds no logic, deliberately.** One authenticated GET and a log line. Who
is next in the lane, the force-accept floor, the transaction that re-checks each
lead — all of it stays in the CRM. A second implementation of "who gets this
lead" running on another host is how two systems begin disagreeing about the
same lead, so there is not one.

**The Vercel daily run is deliberately left in place** as a backstop. Every
handler re-checks state inside a Firestore transaction, so the two schedules
cannot conflict — if Railway is down, the nightly run still clears the backlog.

**Measured before scheduling it, because `*/5` is where this project has been
bitten before** (a `*/5` sweep × 165 stale leads was once ~47,500 writes/day
against a 20k cap). At 288 runs a day: both expiry queries are bounded and
return nothing when nothing is due, and the stale-lead alert is still gated to
once per Karachi day by `config/cronState.staleSweepDayKey` — about **860 reads
a day** against a 50,000 cap, with writes only when something has actually
expired.

**A wrong-secret probe against production answered a question the notes had
wrong.** `CRON_SECRET` is **set on the Vercel deployment** — the route replied
`401 Unauthorized`, where a missing secret fails closed with `503 "Scheduler is
not configured"`. *Operational state* above still says both cron routes refuse
to run for want of it; that is stale for the deployment, whatever `.env.local`
holds. The probe proved reachability, the header shape and the deployment's
configuration **without running a sweep**.

- `CRM_URL` must be **https** — the secret travels in a header, and anyone
  holding it can trigger reassignment across the whole pipeline.
- A timeout says plainly that the sweep **may still have run**; every handler is
  idempotent and the next run finishes what this one started.
- Failures exit non-zero, so a broken run shows as failed in Railway rather than
  a green tick with the error buried in the output.

- **Validation**: `typecheck` 0 errors, `test` 689/689, `eslint src` unchanged at
  7 errors / 33 warnings, `node --check` clean. The three configuration guards
  (no URL, plain http, no secret) were each exercised and exit 1 with the
  message naming the fix.

  **Run end to end against production, and it was made safe by measuring
  first.** A read-only probe counted the backlog before anything was fired: **0
  NEW leads past the admin window, 0 ASSIGNED past the accept window, 0 ASSIGNED
  at all**, and the stale marker already on today's Karachi key — so the sweep
  was a proven no-op before it was called, not merely assumed to be one. It then
  returned `200 {"ok":true,"autoAssigned":0,"reassigned":0,"noFollowUpAlerts":0,
  "durationMs":277}`. That proves the URL, the header shape and the secret, and
  confirms `.env.local`'s `CRON_SECRET` matches the deployment's. The probe
  script was deleted; nothing was written.

  **Worth keeping as a habit:** "is this destructive" was answered by counting
  the rows it would touch, which took one read-only query and turned a
  confirm-first action into a demonstrably free one.

  **Deployed and running.** Project `crm-lead-cron` on the Datax Railway
  account, service `lead-cron`, registered by Railway as a **cron job** (not a
  long-running service). Its first scheduled run:

  ```
  [sweep] /api/cron/process-deadlines → 200 in 1516ms:
          {"ok":true,"autoAssigned":0,"reassigned":0,"noFollowUpAlerts":0,"durationMs":333}
  [sweep] done — 1 target(s) swept.   [exited with code 0]
  ```

  That is the test that matters — it proves the Railway service's own
  environment variables, not this machine's.

  **Two config formats were rejected, both on how they fail.** `railway.json`
  stops being honoured on **2026-12-01**; a schedule that quietly reverted would
  stop leads cascading with nothing to say so, which is the exact silent failure
  this service exists to fix. `.railway/railway.ts` needs the `railway` npm
  package installed to compile — a `node_modules` in a service whose whole job
  is one `fetch` — and `railway config migrate` emits `cronSchedule` as a
  **comment** rather than a field, so migrating silently drops the one setting
  that matters. `cronSchedule`, `restartPolicyType` and `startCommand` are
  stored on the service instead: no expiry, no dependency. The README carries
  the GraphQL call to restore them.

  `restartPolicyType: NEVER` is deliberate — a cron run is meant to exit, and
  restarting it would turn a five-minute schedule into a hot loop against the
  CRM.

  **Deployed by directory upload (`railway up` from `ops/lead-cron`), not from
  GitHub**, so there is no root-directory setting to get wrong. Stated cost: it
  does **not** redeploy on `git push`.

  **`CRON_SECRET` was echoed to the terminal** by the Railway CLI when the
  service was created with `--variables`, so it is in that session's scrollback.
  Low severity — the secret only triggers the sweep, it reads no data — but the
  realistic abuse is burning the free tier's daily Firestore quota. **Pass the
  variable some other way than `--variables` next time**, and rotate it in
  Vercel and Railway together.

### 2026-09-14 — the lead lane: a screen that explains itself, and an offer you can answer

The priority page was a slate-and-indigo table from an earlier era of the app,
showing a dropdown per employee and nothing about why anybody held the place
they held. Four things now, all from one instruction.

**1 · It is the directory's screen.** `PriorityLaneView` is built on
`directoryChrome` — `E` tokens, `Card`, `Bar`, `HeroRings` — because this page
and the Team page describe the same people, and two design languages for one
roster read as two products. Desktop grid, phone cards via `useIsMobile`; 16px
on every phone input.

**2 · The order is earned, and the card shows the arithmetic.** Each row carries
connects, follow-ups and passes with what each contributed (`+10`, `+3`, `−2`)
and the total beside them. **Sorted by score, not by the priority they currently
hold** — stored-priority order would hide the one disagreement an admin opens
this screen to find: somebody sitting at priority 1 having done nothing this
month.

**3 · Managers are ranked and badged "Not in the lane".** The owner's call: they
appear with their numbers so everyone can be compared, and automatic
distribution still only reaches employees. A manager in a ranked list with no
badge would read as somebody about to be handed leads. Three separate ways out
of the lane are each named on the card — a manager, a paused account, and
`autoAssign: false` ("Manual only"), which is somebody deliberately taken out of
distribution while still able to be handed a lead by hand.

**4 · The offer, with Accept and Pass on.** `IncomingLeadPopup` slides in
wherever the employee is in the app, carrying the lead, its source, a draining
{ACCEPT_WINDOW_MINUTES}-minute clock that turns red under a minute, and both
buttons.

- **Driven by the lead, not the notification.** A notification records that
  something happened; the question here is "is there a lead waiting for an
  answer *right now*", and only the lead knows — `ASSIGNED` with a live
  `acceptDeadlineAt`. Reading the notification would leave the card on screen
  offering a lead that had already gone to the next person.
- **Its own query, and a cheap one.** This mounts on every screen, and an
  employee's pipeline is hundreds of documents. `assignedUserId == me &&
  status == 'ASSIGNED'` — two equality filters, no `orderBy`, so the automatic
  single-field indexes serve it and nothing has to be deployed. Both clauses are
  what the `leads` rule checks, so the query is provable rather than refused.
- **Dismiss is not decline.** The × hides the card; the lead stays assigned and
  the timer keeps running. Closing a window must never give a lead away.
- **The cost of passing is stated before the button, not discovered after it** —
  two points, the same as giving back one connected call.
- It portals to `document.body`, or `.animate-page-transition`'s
  `will-change: transform` pins it to the page's content box and it lands
  cropped or under the phone's tab bar.

**5 · The Meta Ads panel says when a lead lands.** A teal alert per ad, from the
folder's own `lastLeadAt`, with Open and a per-ad dismiss. **Elapsed time, not a
seen-watermark**: a watermark needs storage, goes stale the moment the panel is
opened on a second device, and answers the wrong question — an admin wants to
know what has just come in whether or not they were watching. Ten minutes, then
it leaves on its own.

**`timestampMillis` in `lib/dates`.** The same field arrives in three shapes —
a live `Timestamp` with `toDate()`, a serialised `{seconds, nanoseconds}`, and a
date string from the demo store — and a reader that knows only the first returns
null for the other two. Null here does not throw; it quietly means "never
happened", which is a countdown with no deadline and an alert that never fires.
Two copies of this had already appeared in one round, so it is one tested
function.

**Demo parity: `passLead`.** `clientActions.passLead` had no demo branch, so the
button the popup puts in front of every employee would have done nothing in demo
mode — a feature the product appears to have and does not. The demo mirror
charges the pass, cascades by priority through the same `resolveCascadeAssignee`,
force-accepts at the floor and writes the notification.

**Three `setState`-in-effect errors were caught by the lint rule and fixed
properly**, not suppressed: the popup's entrance, its per-offer reset and its
portal guard are now one reset-during-render state object plus a
`useSyncExternalStore` mounted flag — the pattern `useIsMobile` already uses.

- **Validation**: `typecheck` 0 errors, `test` **689/689** (685 → 689, all on
  `timestampMillis`: the three transports agreeing on one instant, absent
  reading as null rather than the epoch, junk reading as null rather than NaN,
  and a half-deserialised Timestamp whose `toDate()` returns an invalid date),
  `build` compiles, `eslint src` at the 7 pre-existing errors and 33 warnings —
  none of the new files flagged.

  **Not driven in a browser** — Chrome tooling is not enabled for this session.
  The screens are reasoned from the shared components and the data they read;
  nothing here was clicked.

  **The gap named here — a 5-minute window swept once a day — was closed the
  same day from Railway.** See the entry below.

### 2026-09-13 — Data Bank Assigned view, no doubling, personal leads, source filters, private Clients

Measured against the live project first: the admin's Clients listed HR's and Dilawar's folders (one source three times); 13 phone numbers were two leads each, 8 of them re-imports inside FAISAL TOWN 2 LEADS; the admin's "Faisal town 2 Gulf" Client folder counted 43 leads of which 4 were the admin's. Rules above, under **Data Bank & Clients** and **Leads**.

Also fixed while there: bulk promotion deleted the tombstones of the first *N* selected ids rather than the ids actually promoted — harmless while nothing was skipped, a live-record delete the moment the new duplicate skip fires. The phone Data Bank's Back button was hard-coded to `/admin/data-bank` for a manager.

- **Validation**: `typecheck` 0 errors, `test` **660/660**, `build` compiles, `eslint src` 7 errors / 33 warnings (no new ones).

  **Driven against the live project through the running dev server** with real ID tokens, write-free paths only: the employee is offered exactly the admin's 6 folders; a number already assigned from GFS is refused ("That number is already in GFS…"); a manager's folder and a mirror are refused; the admin is refused the employee action; re-importing an assigned number writes 0 and counts 1 duplicate; re-importing the Aqeel Ahmed number into FAISAL TOWN 2 LEADS — the reported case — writes 0. GFS recordCount unchanged afterwards; probe route deleted. The screen derivations were replayed on live data: GFS 1,820 unassigned / 75 assigned (25 each Aroosa, Rafia, Sundus); the admin's Clients 4 folders, "Faisal town 2 Gulf" showing 4.

  **Not driven:** a successful personal lead (it notifies real people), and the screens in a browser — Chrome reached the sign-in page and signing in was not attempted.

  **Left alone, owner's call:** the 13 existing duplicate leads (they carry follow-ups), and the empty-mirror cleanup, which still deletes a manager's mirror once its last row is promoted — its leads stay visible in the source folder's Assigned list and the leads screen's source filter.

### 2026-09-10 (sixth round) — rejecting a paid expense is the owner's call, not the code's

*"remove rejected block"* — the guard added an hour earlier, which refused to
reject an expense that had already been paid from an account.

**The reasoning behind it was not wrong, and it was still the wrong answer.**
Rejecting takes an expense out of approved spend while the cash has already
left, so the books show money gone with nothing booked against it. But the
moment somebody reaches for Reject on a paid expense is precisely the moment
they have discovered the payment was a mistake — and being told to go and
unpick the ledger before they may record that is a dead end at the worst point.
Same shape as the committee's reverse-before-delete refusal the owner removed on
2026-09-09: a guard that is correct about the accounting and wrong about the
person.

**What replaces it is visibility, not a rule.** The funding transactions stay
**POSTED** on the account that paid — the rupees really did leave it, and
deleting that row on the user's behalf would be the code inventing a decision.
The rejection is written into the expense's own history beside the amount
already paid, and the row's payment pill renders whatever the status, so a
rejected expense that cost money reads **`Rejected · Paid`** rather than as a
clean refusal. Removing the funding movement is still what un-pays it; it is a
choice now.

**The amount guard stays**, because it is a different question: an amount below
`paidAmount` is not a decision anybody means to make, it is a record insisting
it was over-funded, and `readPaid` would then report Rs 0 outstanding on
something paid for twice over.

- **Validation**: `typecheck` 0 errors, `test` 534/534, `build` compiles,
  `eslint src` at the 7 pre-existing errors and 34 warnings.

  **Driven end to end against the live project.** A throwaway expense paid 400
  of 1,000 (Committee 500,000 → 499,600): **Reject succeeded**, the expense kept
  `paidAmount: 400 / PARTIALLY_PAID` with `STATUS_REJECTED` appended to its
  history, the balance stayed 499,600 and the funding leg stayed **POSTED**;
  editing the amount to 100 was still refused; re-approving worked and left the
  payment intact. Every probe row deleted — 2 transactions, 11 expenses,
  cachedBalance 500,000, exactly as found.

### 2026-09-10 (fifth round) — paying an expense looked like it did nothing

**Reported:** paying an office expense from an account — the Committee — posts
into the account, *"but its not cutting the paid amount like if i pay full or
half"*.

**The server was right the whole time, and I proved that before changing
anything.** A throwaway route called the real `payFromAccounts` from inside the
running dev server with a real admin token, on a throwaway expense: 400 then
600 moved `paidAmount` 400 → 1000, `paymentStatus` PARTIALLY_PAID → PAID, wrote
two legs, and took the Committee 500,000 → 499,600 → 499,000. Every figure
correct.

**The bug was one line that does not exist.** `mapExpense` in
`useOfficeExpenses` types nothing about payment and reads nothing about it, so
every expense reached the screen with a hard `paidAmount: 0`. Three consequences,
which together are exactly the report:

- the button never left **"Pay from…"** — never "Paid", never "Pay balance";
- `PayFromAccounts` was handed `alreadyPaid: 0`, so after paying half it offered
  the **whole amount** again;
- nothing on the row ever said money had moved.

The only thing stopping a second full payment was the server's in-transaction
guard, which reads the *stored* figure and refused — so the screen showed a
refusal for a payment it had just told the user was still outstanding.

**Sixth outing of this bug class.** See *Lessons*; the count is updated there.

**The row now carries the payment as its own pill**, beside the status one, and
names the balance rather than the fact: `Approved` · `Rs 20,000 due`. An
approved-but-unfunded expense is the normal state and gets no pill, so a pill
appearing means money has actually left an account.

**Two adjacent gaps looked at while there.** Editing a paid expense's **amount
below what had been paid** is refused on the server — it would leave a record
insisting it was over-funded. **Rejecting a funded expense was refused too, and
the owner reversed that within the round** — see the entry below. The refusal
that survives names the way out (remove the funding movement from the account,
which un-pays the expense) rather than being a dead end.

- **Validation**: `typecheck` 0 errors, `test` **534/534** (528 → 534: the part
  payment leaving the balance rather than the whole amount, the over-paid case
  that must never print a negative outstanding, the zero-amount expense that is
  not "settled", and the absent status reading as UNPAID), `build` compiles,
  `eslint src` at the 7 pre-existing errors and 34 warnings.

  **Driven end to end against the live project — ten steps, all as specified.**
  Pay 400 → PARTIALLY_PAID, Committee 500,000 → 499,600. Reject **refused**
  (*"Rs 400 has already been paid out…"*). Edit to 100 **refused**. Pay 601
  **refused**. Pay 600 → PAID, 499,000. Pay 1 more **refused**. Deleting the 400
  leg un-paid it back to 600 / PARTIALLY_PAID and the balance to 499,400. Every
  probe row deleted afterwards: **2 transactions, 11 expenses, cachedBalance
  500,000** — exactly as found.

  **Found while probing, and worth knowing:** there were **no
  `OFFICE_EXPENSE` legs in the live project at all**. The two movements on the
  Committee are both manual ("Gifts" 50,000, "Tour" 500,000). So no payment had
  ever actually committed — consistent with a screen that made the flow look
  broken enough to abandon.

  **Not driven in a browser** — Chrome tooling is still not enabled for this
  session. The pill and the button states are reasoned from the shared
  components; the data they read is proven above.

### 2026-09-10 (fourth round) — the committee screen, transcribed from the design files

`~/Downloads/Website redesign in teal CRM style/` holds
**`Committee Account.dc.html`** and **`Committee Account Mobile.dc.html`**.
`components/accounts/CommitteeStatement.tsx` is transcribed from them —
**values copied, never measured** — and a script diffs ~30 of them (grids,
radii, type sizes, the `KIND_META` colour/path table, the share gradient, the
empty-state copy and padding) against the source files. All match.

Desktop: the 48px teal tile and 29px/800/−1px title, three stat cards on
`minmax(272px,1fr)` with a 3px accent stripe and a 7px progress bar, the pill
search, seven filter chips, the `#fdf7f6` Spendings bar with its count pill and
Add, and rows on `42px minmax(0,1fr) 128px auto auto` carrying a share bar and
a per-row percentage.

Mobile: the 115° gradient hero with the design's three rings, an 88px dial
showing **% used**, a three-up COMMITTEE / SPENT / REMAINING strip in `short()`
notation (lakhs, then thousands), cards at radius 20, and the floating Add.

**One deliberate departure**: the mobile file draws a 390×844 phone with a 9:41
status bar and signal bars. Reproducing that inside a real phone would put a
second status bar under the real one — the CRM's standing rule. The FAB sits
above `env(safe-area-inset-bottom)` for the same reason.

Only **committees** use it. Every other account kind keeps the generic in/out
statement: the design covers committees, and inventing the rest from it would
be guessing.

- **Validation**: `typecheck` 0 errors, `test` 528/528, `build` compiles,
  `eslint src` at the 7 pre-existing errors and 34 warnings. Six routes served
  200, including the live committee at `/admin/accounts/ledger/…`.

  **Not seen rendered** — Chrome tooling is still not enabled for this session.
  The transcription is verified against the files by diff, not by eye.

### 2026-09-10 (third round) — the Accounts section gets its design, and its phone

The ledger and the modules were already built and proven. This round was the
**UI/UX bar and mobile**, which the brief weighted most heavily.

**`components/accounts/accountsChrome.tsx`** is now the section's language:
glass cards over the CRM's own greys and teal, semantic money colours
(`positive` / `negative` / `pending` / `neutral`), the account-kind icon set,
`SummaryCard`, `StatusPill`, `Trend`, `Skeleton`, `EmptyState`, `Button`,
`Chip`. Eight screens, one vocabulary.

**Trends refuse to be invented.** `accountMovement` and `compareToPrevious`
return `changePct: null` whenever there is no comparable prior month — no data,
or a previous month of exactly zero, where the percentage is undefined rather
than infinite. The card then shows the arrow and no number. The brief asked for
this explicitly and it is the kind of thing that otherwise ships as a confident
"↑ 100%" because last month happened to be blank.

**Colour is never the only signal**: every trend carries its arrow and a
screen-reader word, every amount carries `+`/`−`, every status is a word.

**The allocation meter.** The split-payment panel now shows Total / Allocated /
Remaining with a progress bar that turns red the moment the lines exceed what is
owed — the one state that must be impossible to miss.

**The phone is not the desktop shrunk.** `useIsMobile` drives: the balance hero
first, summary cards that scroll by thumb with snap points, account cards full
width, transactions as cards on **both** surfaces, payment lines that stack, and
16px inputs so iOS does not zoom. The three wide tables — marketing income
(11 columns), personal expenses, StateLife (20 columns) — become **cards below
820px** carrying every figure, rather than a horizontal scrollbar nobody uses.

**Micro-interactions** are transform/opacity only, 120–300ms, and fully disabled
under `prefers-reduced-motion`.

- **Validation**: `typecheck` 0 errors, `test` **528/528** (519 → 528: movement,
  and the four cases where a percentage must come back `null`), `build`
  compiles, `eslint src` at the 7 pre-existing errors and 34 warnings.

  **The brief's Final Acceptance Test, run against the live project — every
  line passing.** 50,000 office expense paid 30,000 + 10,000 + 10,000 → Main
  Bank 500k→470k, Cash 100k→90k, **Committee 75k→65k**; the expense reads
  **Paid — PKR 50,000**; the Committee's own row reads *Office Expense —
  Outflow — PKR 10,000* and links back to it; the monthly total is **50,000,
  not 100,000**; the audit trail carries creator, payer, allocations and
  accounts. Plus regression: transfer leaves total company money unchanged,
  personal expense submit → approve → reimburse, StateLife net commission
  **125,354** (the workbook's own row 4), marketing income total cost derived.
  Ten routes served 200. Every probe row deleted; 10 expenses, 9 receivables,
  7 deals, 249 leads untouched.

  **Still not built**: the standalone monthly **Reports** screen (dashboard
  totals and per-account statements are live; the cross-module filtered report
  is not), **receipt upload** on personal expenses, and **notifications** on
  approval events. Office expenses are not yet grouped by day within the month.

### 2026-09-10 (second round) — Accounts becomes the ledger, and everything pays from it

**The de-risking fact, found by looking:** `committee`, `investments`,
`capitalInvestments` and `personalExpenses` are **all empty**. Only `expenses`
(9) and `receivables` (9) hold anything. So the migration questions from the
morning were moot — nothing had to be moved, and the nine office expenses keep
their records, their history and their ids.

**Built, on the tested `lib/ledger` core:**

- `app/actions/ledger.ts` — accounts, `payFromAccounts`, transfers, reversals.
  **Every rupee moves through one of two functions**; no module writes a
  transaction itself.
- `app/actions/accountModules.ts` — personal expenses (submit → approve →
  reimburse, **no self-approval**, enforced server-side), StateLife, Mahziyar
  marketing income.
- `components/accounts/` — the dashboard, the account statement in the
  workbook's **received/spent** layout, `PayFromAccounts` (the split control),
  StateLife, marketing income, personal expenses, and Committee/Capital
  Investment as lists of accounts.
- Office Expenses **moved from Money to Accounts** and gained *Pay from…*.
  Rules deployed; `accounts`, `transactions`, `stateLifePolicies` and
  `marketingIncome` are admin+HR, and an employee reads **only their own**
  personal expenses.

**The guard that makes duplicate payment impossible** is a re-read inside the
Firestore transaction, against the record's current `paidAmount` — not a check
in the browser. Two people paying at once: one commits, the other is refused.

**Two bugs the live run caught that nothing else would have:**

1. **A `"use server"` file may only export async functions.** `accountModules`
   exported a const array; typecheck, lint and `next build` all passed and the
   route died at runtime with *"found object"*. The statuses moved to
   `lib/personalExpenses`.
2. **Voiding a transaction *and* posting its reversal corrects the mistake
   twice.** The balance moved by the amount again, in the wrong direction. The
   right model keeps the original **POSTED** and adds an equal opposite leg, so
   the two cancel and both rows stay on the statement; `reversedBy` is a marker,
   not a status. **A unit test had asserted the buggy number as correct** — it
   is now inverted and kept, as the thing that must not come back.

- **Validation**: `typecheck` 0 errors, `test` **519/519**, `build` compiles,
  `eslint src` at the 7 pre-existing errors and 34 warnings. Rules released to
  `leadway-crm`.

  **Driven end to end against the live project — 30 checks, all passing.** The
  owner's scenario in full: three accounts with opening balances; a 50,000
  office expense paid **30,000 + 10,000 + 10,000**; the expense **still
  50,000**; Bank 200k→170k, Cash 50k→40k, **Committee 100k→90k with its own
  −10,000 named for the expense**; three legs summing to 50,000, each linking
  back; a second payment refused, and one rupee more refused; a transfer typed
  TRANSFER on both legs; approve-then-reimburse with approval moving no money;
  marketing income received in with `totalCost` derived; and a reversal leaving
  the original posted. Every probe row deleted afterwards — 9 expenses, 9
  receivables, 7 deals, 249 leads all exactly as before.

  **Not built**: monthly Reports over the ledger (the dashboard totals are
  there; the filtered report screen is not), receipts upload on personal
  expenses, and the phone layouts for the new Accounts screens — they render
  responsively but are not the separate phone product `components/mobile/`
  gives the rest of the CRM.

### 2026-09-10 — Accounts: the ledger foundation, and what the spreadsheets settled

**Inspected first, and the inspection settled the architecture.**

**The root cause: there was no ledger.** "Accounts" was five collections —
`committee`, `investments`, `capitalInvestments`, `personalExpenses`,
`receivables` — all written by *one* 40-line helper holding
`{title, amount, description, date, addedByUid}`. No account, no balance, no
direction (the sign of `amount` is nowhere recorded), no status, no link to
what caused the entry, no audit. Office expenses were the one real module and
they lived under **Money**, with no idea which account paid. Two halves of the
money story in different places, neither aware of the other.

**The owner's own files said what the shape is.** Read, not guessed —
`Committe.jpg`, `Capital Investment.jpg`, `20260907_143519.jpg` and
`statelife.xlsx`. Every committee and investment block is the *same* layout: a
named pot ("DECEMBER COMMITTEE", "CAR INVESTMENT", "STATE LIFE LOAN") with
`Amount Received | Description` on one side and `SPENDINGS: Amount Spent |
Description` on the other, both totalled. **That is an account statement drawn
by hand.** So Committee is not a module, it is an *account* — and so is Capital
Investment. Which is why "Committee must automatically receive a transaction
when it is a payment source" needs no Committee code: an allocation names an
account and Committee is one. There is no occurrence of the word in
`lib/ledger.ts`.

**StateLife's arithmetic, from the sheet.** Every commission is a percentage of
column **E `PASS`** — not `FYP` — with 8% tax folded into the multiplier:
30% → `E × 0.276`, 10% → `E × 0.092`, quarter 2.5% → `E × 0.023`, Dec 7.5% →
`E × 0.069`; `Remaining = M + N − O`, `Net = P + Q + R`. Guessing would have
used FYP and left the tax out. Full column table in the doc.

**Built: `lib/ledger.ts`**, the pure core everything else will run on —
accounts, transactions, **derived** balances, split allocations, transfers,
reversals, report summaries. The rules that matter:
- **Balances are derived**, never typed: `opening + Σ in − Σ out`. One
  definition, recomputable at any time.
- **A split payment is one obligation and N movements.** The 50,000 expense
  stays 50,000; three legs of 30/10/10 explain the funding. *Money movement is
  read from transactions, obligations from module records — a report that adds
  both is the double count.*
- **Over-allocation is refused, never trimmed**, and one account may appear
  once; idempotency is `sourceModule:sourceId:accountId`, deliberately
  excluding the date so a retry a day later still collides.
- **Transfers are neither income nor expense** — counting them as either
  inflates both sides equally and leaves net movement looking right while
  everything else is wrong.
- **Nothing posted is ever edited or deleted**: void + `reversalOf`.

- **Validation**: `typecheck` 0 errors, `test` **512/512** (482 → 512: 30 on the
  ledger, including the owner's 50,000 = 30+10+10 worked through to three
  account balances and the Committee leg, the duplicate-payment collision,
  part-payment then balance, transfer netting, and void-plus-reversal), `build`
  compiles, `eslint src` at the 7 pre-existing errors and 34 warnings.

  **Blocked, and it blocks a lot: the project's daily Firestore quota is still
  exhausted** — every read returns `RESOURCE_EXHAUSTED` in under a second. So
  no count of the existing records, no migration dry-run, and no end-to-end
  test. Yesterday's 5,500-document delete is the likely spender.

  **Deliberately not built**: the Server Actions, the Firestore rules, the
  migration script and every screen. Building eight modules blind against a
  database that cannot be read or tested is the failure mode the brief warns
  about; the foundation is in and tested, and the rest is mechanical once the
  three migration questions below are answered.

  **Three things the migration cannot infer** and must be answered first — the
  legacy schema simply does not record them: the **sign** of every existing row,
  **which pot** each `committee` / `capitalInvestments` row belongs to (the
  sheets have several named pots, the collection has none), and each account's
  **opening balance**.

### 2026-09-09 (fourth round) — the dossier's date, and what "Written in this period" actually was

**Traced before touching anything, and the trace changed the answer.**

**What that row was.** `EntriesLine` in `DossierControls.tsx`, fed by
`entryActivity.totals` from `buildActivityBreakdown` — a Server Action that
reads `followUps` by `dayKey` over the selected range and folds them with
`entryTally`. It counted **entries**: Remarks, New Connects, Follow-ups,
Follow-up Connects, for the selected period, credited to the lead's assignee.
The same four numbers Reports prints, from the same records through the same
function.

**It was not redundant, and it had already been deleted.** The chips below it
carry the same four words and count **leads**, not entries — 30 follow-ups
across 5 leads is "5" on a chip and "30" on the row, and both are right. So the
row was the only place on the screen with the figures §7 and §8 of the brief
ask for, and the working tree had it removed with `totals` still being fetched
on every render and thrown away.

**Restored, renamed and restructured** rather than re-added as it was, because
the complaint about it was fair — two rows, four identical words, different
numbers:

- headed **"Activity · Today · 09 Sep 2026"** with the qualifier *entries
  written*, so it reads as a day rather than as a second copy of the chips;
- the chip row is now prefixed **LEADS**, naming its unit once;
- a day with nothing on it says **"Nothing logged on this day."** rather than
  showing four zeroes that look like a broken screen — and a failed load says
  so separately, because "nothing" and "did not load" must not look alike;
- it now shows on the **Activity tab too**, where it sits over the very entries
  it counts.

**The date bug named in §3 was real, and it was the default.**
`DEFAULT_DOSSIER_FILTERS` was a module-level constant holding
`day: karachiDayKey()` — evaluated **once, when the bundle first loads**. A tab
left open overnight, or a session started yesterday, opened every dossier on
*yesterday* while the control said "Today". Now `defaultDossierFilters()`, a
function called from the `useState` initialiser, so the clock is read when the
dossier is opened; each dossier also gets its own object.

**One date implementation, and now a testable one.** `lib/dossierPeriod.ts`
holds `defaultDossierFilters`, `dossierDay`, `resolveDossierRange` (a `Date`
interval for the lead/deal/activity lists) and `dossierRangeKeys` (the two
`YYYY-MM-DD` keys the entry query takes). It was in `directoryChrome.tsx`,
where **none of it could be tested** — the raw `--experimental-strip-types`
runner cannot load a `.tsx`. `directoryChrome` re-exports it, so no call site
moved.

**Filtering is in the query, not the browser.** For a picked day `from` and
`to` are the same key and `loadEntries` matches `dayKey >= from && dayKey <=
to`, so one day's entries come back from Firestore. `dayKey` is stamped in
Karachi from `occurredAt`, so the midnight boundary is the business's midnight,
not UTC's. The list ranges use `[midnight, next midnight)` — upper bound
exclusive, so no instant is in two days and none falls between them.

**Cached results cannot leak across dates**: `useDossierActivity` stamps its
state with the key it came from and returns `loading` when the key changes, so
switching day never shows the previous day's numbers while the new ones load.

- **Validation**: `typecheck` 0 errors, `test` **482/482** (469 → 482: the
  month-boundary and 40-day round-trip steps, the picked-day window at both
  ends, the fallback for a junk date, that the default reads the clock and
  returns a fresh object, and that the `Date` range and the `dayKey` range
  describe the same day), `build` compiles, `eslint src` back at the 7
  pre-existing errors and 34 warnings — the tree had drifted to 9/37, and the
  two extra errors were `entryActivity?.items` in a `useMemo` dependency, which
  the React Compiler cannot verify and which made it skip optimising both
  dossiers. `src/lib/dates.test.ts` existed but was never wired into the `test`
  script; it is now.

  **The live re-verification could not be run: the project's daily Firestore
  quota is exhausted.** Even a single document read comes back
  `RESOURCE_EXHAUSTED` in under a second — `preferRest` working exactly as
  intended. The 5,500-document folder deletion earlier today is the likely
  spender. It resets at midnight Pacific.

  What *was* verified live earlier today, on this same unchanged query path:
  `buildActivityBreakdown` against an independent Firestore count on
  **2026-09-09, 2026-09-07 and 2026-09-03** — identical every time, including a
  back-dated day. This round changed the default, the summary UI and moved pure
  functions between modules; it did not touch the query. Re-run the
  consecutive-date leakage check once quota resets.

  **Not driven in a browser** — Chrome tooling is still not enabled for this
  session and the project has no Playwright.

### 2026-09-09 (third round) — Deal Entry becomes four types, and the Cut gets two numbers

**Inspected before touching anything, and the inspection changed the plan
twice.**

**1 · All seven existing deals are in the *pre-2026-09-05* shape** —
`amountReceived` / `payableAmount` only, no `totalPrice`. The four-field form
shipped four days ago and **no deal has ever been saved through it**. That made
the whole change far safer than it looked: `received − payable` is literally the
new Installments formula, so every existing deal reads as an Installments deal
and keeps displaying exactly what it displayed. No migration, no backfill.

**2 · The new Cut rule reverses the one the code says the owner confirmed.**
`lib/dealAmounts` recorded, in prose, that the base is `Remaining` — decided on
their own 50 lakh / 10 lakh example, giving a 1% cut of 40,000. The new rule
makes that same deal 50,000. Raised it explicitly rather than quietly flipping
it; no data was at risk, because of point 1.

**3 · The rule breaks the Profit Distribution model, and that needed a
decision.** The old screen split one pot and gave the company its own
percentage plus the unallocated remainder. With the percentage multiplying one
number and the money leaving a different, smaller one, "the remainder of the
base" is not the company's money. **The owner chose: cuts are a percentage of
the base, the company keeps `source − cuts`, the company percentage is
removed, and an over-allocation is refused rather than capped.** Rules in
**Business rules → Money**.

**4 · Legacy deals take the new rule too**, at the owner's instruction — one
rule per type, never a second one depending on when the deal was entered. For
the five unsplit deals the base moves from `profit` to Amount Received (one goes
from 1,000,000 to 5,000,000), which is why both figures are now printed on the
distribution screen with the field each came from. The two finalised splits are
frozen records and are untouched.

**What the code now holds:**

- `cutBase` and `payoutSource` are stored on the deal at entry and **frozen
  again on the split**, so a later rule change cannot restate what anybody was
  paid. Older deals derive both from the same table.
- **A Lump Sum has no Remaining at all** and its Commission is typed, never
  `received − payable`. Its mirrors carry the **Commission**, so the ~30 revenue
  readers book 4 lakh and not the 40 lakh that went to the builder.
- Validation is per type and only judges boxes that are on that type's form.
  `commission > receivedAmount` is refused as a transposed pair — it would put a
  10× cut base into the ledger permanently.
- `dealFigureRows` / `dealCutRows`: one decision about which boxes a deal has,
  rendered by all four surfaces that display one.

- **Validation**: `typecheck` 0 errors, `test` **469/469** (435 → 469: the four
  worked examples on both the deal arithmetic and the split, the base-is-not-the-
  source proofs, per-type validation, the legacy readings including the
  loss-making deal, and the rupee over-allocation test), `build` compiles,
  `eslint src` at the 7 pre-existing errors and 34 warnings.

  **Driven end to end against the live project.** A throwaway
  `/api/probe-deal` route called the real `closeDeal` and
  `finalizeProfitDistribution` from inside the running dev server with a real
  admin token, on four throwaway leads:

  | type | stored |
  |---|---|
  | Down Payment | remaining 40L · cutBase 50L · payoutSource 40L · profit 40L |
  | Confirmation | remaining 40L · cutBase 50L · payoutSource 40L · profit 40L |
  | Installments | remaining 3L · cutBase 10L · payoutSource 3L · profit 3L |
  | Lump Sum | **remaining null** · cutBase 40L · payoutSource 4L · profit **4L** |

  A 1% split on the lump sum produced a **40,000** cut — 1% of the client's 40
  lakh, not of the commission — a 40,000 payout row, and **360,000** retained.
  A 20% share was **refused**: *"The cuts come to Rs 800,000, more than the Rs
  400,000 available."* All four probe leads, their deals, events,
  notifications, distribution, payout and KPI increment were then deleted; the
  route and script are gone. Confirmed afterwards: 7 deals, 198 leads, 2
  distributions, 0 probe rows — exactly as before.

  **Not driven in a browser.** Chrome tooling is still not enabled for this
  session and the project has no Playwright, so the four-button type selector
  and the conditional fields are reasoned from the shared components rather
  than clicked. The server path they feed is proven above.

  **Nothing to deploy** — no new index, no rules change.

### 2026-09-09 (second round) — the dossier was counting the record, not the day

**Reported:** an employee's connects, remarks, follow-ups and follow-up connects
"are not aligned with what they actually are"; picking Today should show only
what was written today; and a calendar to pick any date.

**Measured first, against the live project.** For Aroosa on 2026-09-09:

| | Remarks | Follow-ups | New connects | Follow-up connects |
|---|---|---|---|---|
| written that day | 0 | 11 | 0 | **3** |
| the dossier showed | 0 | 11 | — | **Connected 7** |

Reports was right. The dossier was answering its activity cuts from the lead's
**all-time** `followUpCount` and `connectCount`, with only the lead's *last
touch* filtered to the period — so a lead touched today that had been connected
with a fortnight ago counted as a connect today. Four of those seven happened on
other days.

**Now the cuts count entries, on the day they were written.** Five of them —
Remarks · New connects · Follow-ups · Follow-up connects · Connected — and a
remark that connected lands in Remarks *and* New connects, which is what the
owner asked for. Rules in **Business rules → KPI**.

- **One classification, `entryTally`.** Reports folds it into a person's row,
  the dossier folds it per lead, and the demo store uses it too. The report's
  own inline copy of "is this a Remark, and which connect column" is gone —
  two readings of that question is how the two screens came to disagree.
- **One query, `lib/reportEntries`.** `loadEntries` moved out of
  `app/actions/reports.ts`, because a `"use server"` module may only export
  Server Actions and two of them now need it. The collection-group index
  fallback moved with it, unchanged.
- **A four-figure strip above the chips**, showing what was *written* in the
  period. The chips count **leads** and the strip counts **entries** — 30
  follow-ups across 5 leads is "5" on a chip and "30" on the strip, both right,
  and that is precisely the comparison that was being made. Loading shows "—"
  and a failure shows the error: four zeroes would read as a person who did
  nothing all day, which is the worst way for this screen to be wrong.
- **A calendar.** "Pick a date…" plus a native date input, so 7 July is two
  clicks. `karachiDayRange` makes it the whole day *in Karachi* — a range built
  from the browser's midnight starts five hours late and takes five hours of the
  8th with it.

**Also fixed: a Data Bank record could be *edited* onto a number the folder
already held.** Adding a duplicate was refused and named the holder; changing an
existing row's number to a colliding one was not checked at all, on either the
real path or the demo one. Both now run `refuseDuplicatePhone`, ignoring the row
being edited so saving a record without touching its number is not reported as
its own duplicate. The message was rewritten to lead with the person —
`duplicatePhoneMessage`, shared so the action, demo mode and the tests cannot
produce different sentences. Scope stays **per folder**, at the owner's
instruction.

- **Validation**: `typecheck` 0 errors, `test` **435/435** (413 → 435: the
  connected-remark-is-both rule, the three tally states, the Karachi day
  boundary in both directions, and the duplicate message), `build` compiles,
  `eslint src` at the 7 pre-existing errors and 34 warnings.

  **Proven end to end against the live project.** A throwaway
  `/api/probe-activity` route called `buildActivityBreakdown` from inside the
  running dev server with a real ID token, and its output was compared with an
  independent count taken straight out of Firestore, on three days:

  | day | Firestore | the action |
  |---|---|---|
  | 2026-09-09 | 0 / 11 / 0 / 3, 11 leads | identical |
  | 2026-09-07 | 8 / 26 / 2 / 4, 34 leads | identical |
  | 2026-09-03 | 14 / 7 / 6 / 2, 21 leads | identical |

  The route and the script were deleted afterwards; nothing was written.

  **Not driven in a browser** — Chrome tooling is still not enabled for this
  session and the project has no Playwright or Puppeteer. The strip, the chips
  and the date input are reasoned from the shared components, not observed.

  **Found and not fixed, because fixing it means inventing data:** the folder
  `7ADU0uFu3X30QsipfceC` is an **empty document** — `{}` — with **5,500
  records pointing at it**. It has no name, no fields and no roles, so the app
  cannot render it and those rows are unreachable through the UI. It is by far
  the largest folder in the project. Recreating the field definitions is a guess
  about what the source sheet's columns meant; the owner should say.

### 2026-09-09 — the manager kind was saving all along; HR runs the pipeline

**1 · "Changing a manager to HR does not stick."** It was sticking. Read
straight out of the live project before touching anything: **Tayyab Ali** is
`managerKind: 'HR'` on the document *and* `managerKind: 'HR'` on the auth claim,
and so is Dilawar Riaz. `updateEmployee` had always written it, and had always
re-issued the claim and revoked the token with it.

**The read was broken, in the mapper.** `useSubAdmins` types `managerKind` on
`EmployeeData` and never took it out of the snapshot — so every manager arrived
in the directory as `SALES`. Two consequences, and the second is the one that
made it look like a failed save: the edit form initialises from
`manager?.managerKind ?? "SALES"`, so it **opened on Sales Manager** for an HR
manager; and it sends `managerKind` on every submit, so **editing a manager's
phone number quietly wrote Sales back over HR**. The field is now read, along
with `monthlySalary`, `salaryAccess` and `kpiScore`, which the same mapper was
also dropping.

This is the **fifth** outing for that bug class (`phone`/`joinedAt`/`notes`/
`autoAssign`, `monthlySalary`, the payroll fields, the client-folder fields).
Check the mapper, not just the type.

**The kind is now on the manager card**, a Sales/HR pill under the email. It had
been visible in exactly one place — inside the edit form — which is why a wrong
value could sit there unnoticed, and why the owner had no way to confirm a
change had taken.

**2 · An HR manager now runs lead distribution for the whole company.** The
owner's call, asked and confirmed: HR sees every lead and may hand any of them
to any active employee, whatever team that employee is on; a Sales manager is
unchanged. It reuses `isHrManager` rather than adding a fourth role — HR already
means "company-wide" for attendance, leave, salary and the report subjects, and
a second flag would be a second thing to keep in step.

- **The reach rule is one function.** `canAssignLeadTo` in
  `constants/hierarchy.ts`, asked by `readAssignableEmployee` and by
  `assignLeadsBulk`, with 7 tests. Three call sites each restating "unless they
  are HR" is how one of them ends up not saying it.
- **The lead files under the recipient's manager.** `assignmentStamp` already
  took `subAdminUid` off the employee rather than off the assigner, so a lead HR
  hands to one of B's people lands in B's pipeline and B's rules — no change
  needed, but it is the thing that makes the feature safe.
- **`DecodedAuth` now carries `managerKind` and `isHr`**, resolved once in
  `verifyAuth` from a profile document it was already reading. The **document
  wins over the claim** here: a manager whose kind changed a moment ago still
  holds the old claim, and reading the claim first would leave an ex-HR manager
  with HR reach until their token refreshed.
- **Both read hooks take a `companyWide` flag**, and the Security Rules carry
  the matching `isHr()` clause on `leads`, `users`, the two lead subcollections
  and the `closedDeals` **get**. Not the `closedDeals` *list*: the deal ledgers
  are a different question from lead distribution and nothing HR uses lists them
  unscoped. Without the rules the widened query is **refused outright, not
  trimmed** — the screen would render with nothing in it, which is this
  project's most-repeated symptom.
- The assign select now names each person's **job title** beside their lane
  priority. The list is no longer always one team, and "which of these is a
  Sales Executive" is the question being answered at that control.

- **Validation**: `typecheck` 0 errors, `test` **413/413** (406 → 413, all on
  the reach rule: HR across teams, Sales confined to theirs, an employee
  refusing outright, and a junk `managerKind` falling back rather than opening
  up), `build` compiles, `eslint src` at the 7 pre-existing errors and 34
  warnings. Four routes served 200 off the running dev server.

  **Not driven in a browser.** Chrome tooling was not enabled for this session
  and the project has no Playwright or Puppeteer, so nothing here was clicked.
  What *was* proven against the live project is the part the report turned on:
  the stored `managerKind` and the auth claims for all four managers, read with
  the Admin SDK. The live data was **not** modified.

  **`npm run test:rules` was not run** — this machine has Java but not the
  Firebase CLI. The new HR assertions in `scripts/rules.test.mjs` are unverified.

  **Owed, and the feature is inert until it lands: `npm run deploy:rules`.**
  Until the new `isHr()` clauses are deployed, an HR manager's leads screen is
  refused the unscoped query and renders **empty**. The CLI is not installed
  here, so this is the owner's to run.

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

### 2026-09-08 — Admin & Sub-Admin Attendance Editing from Calendar

**Admin and Sub-Admin can now directly edit employee attendance from the calendar view.**
Previously, attendance cells on `/admin/attendance/calendar` and `/subadmin/attendance/calendar`
either disabled clicks on unrecorded dates, dropped check-in/out times, or restricted
adjustments to HR managers only.

1. **Permissions & Team Scope:**
   - Server Action `adjustAttendance` in `src/app/actions/attendance.ts` validates manager claims
     (`requireManager`). Sub-Admins are permitted to adjust their own team members and their
     own personal attendance (`uid === teamOf`).
   - `/subadmin/attendance/calendar/page.tsx` now passes `canAdjust={true}` to `TeamCalendarView`
     for all Sub-Admins rather than gating on `isHr`.
2. **Unrecorded Days Clickable:**
   - `resolveDay` in `src/components/attendance/TeamCalendarView.tsx` resolves an unrecorded day
     fallback so past/current dates without an existing Firestore document can be clicked to open
     `DayDetailPanel`.
   - In both individual and whole team grid modes, buttons are accessible for any employee and date.
3. **Timezone & Time Inputs Pre-filling:**
   - `DayDetailPanel.tsx` locks time rendering to `Asia/Karachi` to prevent local browser UTC offsets.
   - Pre-fills current/adjusted check-in and check-out in `HH:mm` format and current status.
   - Saves `adjustedCheckIn` and `adjustedCheckOut` as well as updated `workedMinutes`.
   - Modifying check-in recalculates tardiness against the active `AttendancePolicy`.
4. **Demo Store Parity:**
   - `src/lib/demo/store.ts` maps `adjustedCheckIn`/`adjustedCheckOut` to `checkIn`/`checkOut`
     and updates `workedMinutes` and the `adjustments` audit trail on `adjustAttendance`.
