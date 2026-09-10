# Accounts — the central ledger

Status: **foundation built and tested; modules not yet migrated.** See
*What is built* at the foot.

---

## 1. Root cause

"Accounts" was never a financial system. It was five independent Firestore
collections — `committee`, `investments`, `capitalInvestments`,
`personalExpenses`, `receivables` — every one of them written by the *same*
40-line helper (`addGenericRecord` in `app/actions/accounts.ts`) and holding the
same four fields:

```ts
{ title, amount, description, date, addedByUid }
```

There is no account, no balance, no direction, no status, no approval, no link
to whatever caused the entry, and no audit trail. `amount` is a bare number
whose sign nobody records. Every page is `useGenericAccountCollection`, a live
list of that collection sorted by date. Nothing reconciles with anything,
because there is nothing to reconcile *against*.

Office expenses are the exception and they live somewhere else — a genuinely
richer module (`lib/officeExpenses.ts`, `app/actions/officeExpenses.ts`) with
categories, receipts, and a `PENDING → APPROVED → REJECTED` decision — filed
under **Money**, not Accounts, and with no concept of which account paid.

So the two halves of the money story are in different places and neither knows
about the other. That is the design issue; nothing is fixable by patching a
page.

## 2. What the owner's own spreadsheets say

Read from the source files rather than assumed:

- `Committe.jpg` — a block headed **DECEMBER COMMITTEE** with
  `Amount Received | Description` down the left, `SPENDINGS: Amount Spent |
  Description` down the right, each totalled (PKR 1,050,000 both sides).
- `Capital Investment.jpg` and `20260907_143519.jpg` — the **CAPITAL
  INVESTMENT** sheet, holding several such blocks stacked vertically:
  **CAR INVESTMENT** (received 1,075,000 from "INVESTOR"), **STATE LIFE LOAN**
  (1,192,500 + 428,000 + 130,000), each with its own SPENDINGS column.
- Workbook tabs: `COMMITTE 2025`, `CAR SALE PURCHASE`, `CAPITAL INVESTMENT`,
  `INVESTMENT WITH AUN`, and at least one more.

**They are all one shape: a named pot, money in with a description, money out
with a description, both totalled.** That is an account statement, drawn by
hand, once per pot.

So Committee is not a module — **it is an account**. So is Capital Investment,
and so is "Investment with Aun". This is why the owner's requirement that
"Committee must automatically receive transactions whenever it is selected as a
payment source" needs no Committee-specific code: an allocation names an
account, and Committee is one.

## 3. The model

```
   Account ──< Transaction >── Source module + source record
```

### `accounts/{id}`

| field | notes |
|---|---|
| `name` | "Meezan Bank", "Cash in hand", "December Committee" |
| `kind` | `BANK · CASH · WALLET · INVESTMENT · COMMITTEE · OTHER` |
| `openingBalance` | what it held before the ledger. **Not a transaction** — it has no date, no source, no counterparty |
| `status` | `ACTIVE` (postable) / `ARCHIVED` (readable only) |

**No stored balance is authoritative.** `accountBalance()` derives it as
`opening + Σ in − Σ out` over posted transactions. A cached copy may be kept for
list performance, but it is a cache and the derivation is the answer.

### `transactions/{id}`

| field | notes |
|---|---|
| `accountId` | which pot moved |
| `direction` | `IN` / `OUT` — amounts are **always positive**, this carries the sign |
| `amount`, `type` | `INCOME · EXPENSE · INVESTMENT · TRANSFER · REIMBURSEMENT · ADJUSTMENT` |
| `dayKey` | `YYYY-MM-DD` **Karachi**, so string compare is date compare |
| `sourceModule`, `sourceId`, `sourceLabel` | the record that caused it, openable from the row |
| `groupId` | ties the legs of one split payment, and the two legs of one transfer |
| `counterAccountId` | the other side of a transfer |
| `status` | `POSTED` / `VOIDED` |
| `reversalOf` | set on a correcting leg |
| `createdByUid`, `createdAt` | audit |

## 4. Split payments — the rule that prevents double counting

A 50,000 expense funded 30,000 + 10,000 + 10,000 is **one obligation and three
movements**. The expense record stays 50,000; the ledger holds three
transactions summing to 50,000.

> **Money movement is read from `transactions`. Obligations are read from module
> records. A report that adds both is the double count.**

`checkAllocations()` enforces:

1. the obligation is never altered by its funding;
2. over-allocation is **refused, never trimmed** — silently reducing a line
   hides either a typo or a duplicate payment;
3. *fully paid* means `allocated === payable` to the paisa;
4. one account may appear once — the same account twice is the shape a
   duplicate payment arrives in.

Idempotency key is `sourceModule:sourceId:accountId`, so a double-click, a
retry, or a second tab collides instead of paying twice. It deliberately
excludes the date and the group, so a retry the next day still collides.

## 5. Transfers

Two legs, one `groupId`, `type: TRANSFER` on both. Transfers are **neither
income nor expense** — counting them as either inflates both sides equally,
leaving net movement right and every other figure wrong. Across the business
they net to zero; across one account they are a real movement.

## 6. Corrections

A posted transaction is never edited and never deleted. A correction marks the
original `VOIDED` and posts `reversalOf()` — the opposite leg, on the
correction's own date, naming what it undoes. The balance lands where a silent
edit would have left it, with both rows still on the statement.

## 7. StateLife — exact structure

From `statelife.xlsx`, sheet **STATE LIFE RECORD**, header row 3. Every
commission is a percentage of **column E (`PASS`)** — *not* `FYP` — with 8% tax
folded into the multiplier:

| # | column | rule |
|---|---|---|
| A | Sr | |
| B | Proposal No | |
| C | Name | |
| D | FYP | first-year premium |
| E | **PASS** | **the commission base** |
| F | SR Code | |
| G | Date | mixed text and Excel serials in the source — normalise on import |
| H | Paid Amount | |
| I | Paid Date | |
| J | Policy Number | |
| K | Description | free text status: `PAYMENT CLEARED`, `5K PENDING`, … |
| L | Sr Name | the salesperson |
| M | 30% − tax 8% | `E × 0.276` |
| N | 10% − tax 8% | `E × 0.092` |
| O | Discount | typed |
| P | Remaining commission | `M + N − O` |
| Q | Quarter commission 2.5% | `E × 0.023` |
| R | Dec commission 7.5% | `E × 0.069` |
| S | **Net commission** | `P + Q + R` |
| T | Description | income period, e.g. "42.5% JANUARY INCOME" |

Totals row sums D, E, H, M, N, O, P, Q, R, S. Note the source has *pasted
values* in most rows and formulas in only a few — the formulas above are the
intent, taken from rows 4, 5 and 8.

## 8. Migration plan

**Nothing is deleted.** Every legacy collection keeps its documents; migration
*adds* ledger rows and a `migratedToTransactionId` back-pointer, so a run can be
verified, re-run, and reversed by deleting only what it created.

| existing | becomes | notes |
|---|---|---|
| `committee` | account `kind: COMMITTEE` + one transaction each | sign inferred from the record; **ambiguous rows are listed, not guessed** |
| `capitalInvestments` | account `kind: INVESTMENT` + transactions | one account per named pot once the pots are confirmed |
| `investments` | account `kind: INVESTMENT` + transactions | |
| `personalExpenses` | `personalExpenses` records + `EXPENSE` transactions | needs an employee per record; legacy rows have none |
| `receivables` | left as is for now | an obligation, not a movement — enters the ledger when paid |
| `expenses` (office) | moves under Accounts, keeps its id and history | approved-but-unpaid rows get **no** transaction: approval ≠ payment |

Three things must be settled with the owner before the migration writes
anything, because they cannot be inferred from `{title, amount, date}`:

1. **the sign of every legacy row** — the existing schema records no direction;
2. **which pot each `committee` / `capitalInvestments` row belongs to** — the
   sheets have several named pots, the collection has none;
3. **the opening balance of every account.**

The script is therefore **dry-run by default**, prints a per-collection
classification with the ambiguous rows named, and writes only with `--confirm`
plus the project id typed back — the same two gates as `purge-all-data`.

## 9. Permissions

Server-side, on the existing roles:

| action | who |
|---|---|
| create/archive account, set opening balance | Admin |
| post a payment, transfer, reverse | Admin; HR for office/personal expenses |
| approve an expense | Admin, HR — **never the requester** (no self-approval) |
| submit a personal expense | any employee, own only |
| read own personal expenses | the employee |
| read all accounts and transactions | Admin, HR |
| read a Sales manager's own team's personal expenses | that manager |

Firestore rules mirror each read clause, per the project's rule that a list
query must prove its own scope.

## 10. What is built

**Built and tested (30 tests, `src/lib/ledger.test.ts`):**
`src/lib/ledger.ts` — account kinds, transaction model, derived balances, split
allocation validation, allocation→transaction expansion with idempotency keys,
transfers, reversals, and the report summaries. Includes the owner's exact
50,000 = 30 + 10 + 10 scenario and the Committee auto-posting case.

**Not built:** the Server Actions and Firestore rules, the migration script, and
every module and screen (Office Expense move, Personal Expenses, StateLife,
Committee/Capital Investment statements, Marketing Income, dashboard, reports).

**Blocked:** the project's daily Firestore quota is exhausted, so no live
inspection of existing volumes, no migration dry-run, and no end-to-end test
could be run this session.
