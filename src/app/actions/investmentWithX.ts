"use server";

/**
 * Investment with X — books of rounds, each round's net profit banked.
 *
 * The arithmetic and the reasoning are in `lib/investmentWithX`, tested against
 * every complete row of the owner's sheet. This file is the half the sheet
 * cannot do: **the net profit reaches the ledger**, into one income account per
 * book, the same way Car Sale and Marketing Income bank theirs — so an office
 * expense can be paid straight *from* an investment's profit.
 *
 * **The net moves into the book's account; the amount moves out and back.** A
 * round names the account(s) its amount was taken from — Investor A, M, the
 * bank — and the money leaves them on the round's date and goes back into them
 * when the round is **received** (`lib/investmentWithX.checkRoundFunding`).
 * The share columns are facts on the sheet, not movements.
 *
 * **Nothing comes back until somebody presses Received** (owner, 2026-09-23).
 * The return date is when the money is expected; a round not yet received has
 * banked no profit and returned no capital (`setInvestmentRoundReceived`).
 *
 * Those capital legs are typed `INVESTMENT`, never `INCOME`: the company's own
 * money going round is not earnings, and the group income sheet skips them.
 *
 * **One transaction per round, rewritten in place** (`invx_{roundId}`), so an
 * edit replaces the movement it already posted rather than leaving two, and the
 * account's cached balance moves by the difference.
 *
 * **Changing a book's columns or its net basis re-posts every round in it**:
 * both change what each round's net is, and a book whose rows say one net and
 * whose account holds another is exactly the disagreement this module exists
 * to prevent.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, requireAdmin, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import { money } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import {
  DEFAULT_SHARE_COLUMNS,
  calculateRound,
  checkRoundFunding,
  fundingDeltas,
  fundingLegs,
  investmentAccountId,
  isRoundReceived,
  normalizeNetBasis,
  normalizeShareColumns,
  possibleFundingLegIds,
  readFunding,
  readShareColumns,
  receivedDayFor,
  roundProfitEffect,
  postedEffect,
  type FundingLeg,
  type FundingLine,
  type NetBasis,
  type ShareColumn,
} from "@/lib/investmentWithX";
import { FieldValue } from "firebase-admin/firestore";

const BOOKS = "investmentBooks";
const ROUNDS = "investmentRounds";
const ACCOUNTS = "accounts";
const TRANSACTIONS = "transactions";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

const dayOrNull = (raw?: string | null) => (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);

/* -------------------------------------------------------------------------- */
/* Books                                                                       */
/* -------------------------------------------------------------------------- */

export interface InvestmentBookInput {
  name: string;
  /** Who the money is with — "Aun", "X". Shown under the book's name. */
  partner?: string | null;
  columns?: Array<{ key?: string | null; label?: string | null }>;
  netBasis?: NetBasis;
  description?: string | null;
}

/**
 * Creates or edits a book, and keeps its income account named after it.
 *
 * Removing a column that still holds an amount on any round is **refused**, and
 * the message names how many rounds: silently dropping a 25,000 share would
 * raise those rounds' net profit and bank money nobody earned.
 */
export async function saveInvestmentBook(
  token: string,
  input: InvestmentBookInput,
  bookId?: string
): Promise<ActionResult<{ bookId: string; reposted: number }>> {
  return runAction("saveInvestmentBook", async () => {
    const auth = await requireFinance(token);

    const name = (input.name ?? "").trim().slice(0, 60);
    if (!name) throw new UserFacingError("Give the book a name — “Investment with X”.");

    const columns = input.columns ? normalizeShareColumns(input.columns) : DEFAULT_SHARE_COLUMNS;
    const netBasis = normalizeNetBasis(input.netBasis);
    const ref = bookId ? adminDb.collection(BOOKS).doc(bookId) : adminDb.collection(BOOKS).doc();

    let previousColumns: ShareColumn[] = [];
    let previousBasis: NetBasis = "PROFIT";
    if (bookId) {
      const snap = await ref.get();
      if (!snap.exists) throw new UserFacingError("That book no longer exists.");
      previousColumns = readShareColumns(snap.data()?.columns);
      previousBasis = normalizeNetBasis(snap.data()?.netBasis);

      const removed = previousColumns.filter((old) => !columns.some((column) => column.key === old.key));
      if (removed.length > 0) {
        const rounds = await adminDb.collection(ROUNDS).where("bookId", "==", bookId).get();
        for (const column of removed) {
          const holding = rounds.docs.filter((doc) => money(doc.data().shares?.[column.key]) !== 0).length;
          if (holding > 0) {
            throw new UserFacingError(
              `${column.label} still has an amount on ${holding} round${holding === 1 ? "" : "s"}. Clear those amounts first, or rename the column instead of removing it.`
            );
          }
        }
      }
    }

    const accountId = investmentAccountId(ref.id);
    await ref.set(
      {
        name,
        partner: (input.partner ?? "").trim() || null,
        columns,
        netBasis,
        description: (input.description ?? "").trim() || null,
        accountId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: auth.uid,
        ...(bookId ? {} : { createdAt: FieldValue.serverTimestamp(), createdByUid: auth.uid }),
      },
      { merge: true }
    );

    const accountRef = adminDb.collection(ACCOUNTS).doc(accountId);
    const accountSnap = await accountRef.get();
    if (!accountSnap.exists) {
      await accountRef.set({
        name,
        kind: "INCOME",
        openingBalance: 0,
        cachedBalance: 0,
        status: "ACTIVE",
        note: "Net profit from this investment book. Expenses can be paid straight out of it.",
        createdByUid: auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else if (accountSnap.data()?.name !== name) {
      await accountRef.update({ name });
    }

    const basisChanged = bookId && previousBasis !== netBasis;
    const reposted = basisChanged ? await repostBook(ref.id, columns, netBasis, name, auth) : 0;
    return { bookId: ref.id, reposted };
  });
}

/** Recomputes every round's net in a book and rewrites its movement. */
async function repostBook(
  bookId: string,
  columns: ShareColumn[],
  netBasis: NetBasis,
  bookName: string,
  auth: DecodedAuth
): Promise<number> {
  const rounds = await adminDb.collection(ROUNDS).where("bookId", "==", bookId).get();
  let delta = 0;
  let count = 0;
  for (const doc of rounds.docs) {
    const data = doc.data();
    const figures = calculateRound(
      { amount: data.amount, profit: data.profit, grossProfit: data.grossProfit, shares: data.shares ?? {} },
      columns,
      netBasis
    );
    if (money(data.netProfit) === figures.netProfit) continue;
    await doc.ref.update({ netProfit: figures.netProfit, totalShares: figures.totalShares });
    count += 1;
    // A round not yet received has banked nothing, so there is nothing to re-bank.
    if (!isRoundReceived(data)) continue;
    const profitRef = adminDb.collection(TRANSACTIONS).doc(`invx_${doc.id}`);
    const posted = await profitRef.get();
    const dayKey = receivedDayFor(data) ?? karachiDayKey();
    if (figures.netProfit !== 0) {
      await profitRef.set(
        profitMovement(doc.id, bookId, bookName, money(data.amount), (data.description as string) || null, figures.netProfit, dayKey, auth)
      );
    } else if (posted.exists) {
      await profitRef.delete();
    }
    delta += figures.netProfit - postedEffect(posted.exists ? posted.data() : null);
  }
  const rounded = Math.round(delta * 100) / 100;
  if (rounded !== 0) {
    await adminDb.collection(ACCOUNTS).doc(investmentAccountId(bookId)).update({
      cachedBalance: FieldValue.increment(rounded),
    });
  }
  return count;
}

/** The one income row a received round owns. A loss is an `OUT` leg of its absolute value. */
function profitMovement(
  roundId: string,
  bookId: string,
  bookName: string,
  roundAmount: number,
  description: string | null,
  netProfit: number,
  dayKey: string,
  auth: DecodedAuth
) {
  return {
    accountId: investmentAccountId(bookId),
    direction: netProfit < 0 ? "OUT" : "IN",
    amount: Math.abs(netProfit),
    type: netProfit < 0 ? "EXPENSE" : "INCOME",
    dayKey,
    sourceModule: "INVESTMENT_WITH_X",
    sourceId: roundId,
    sourceLabel: `${bookName} — ${formatMoney(roundAmount)} round${netProfit < 0 ? " at a loss" : ""}`,
    groupId: null,
    status: "POSTED",
    note: description,
    idempotencyKey: `INVESTMENT_WITH_X:${roundId}:${investmentAccountId(bookId)}`,
    createdByUid: auth.uid,
    createdByName: auth.name ?? auth.email ?? null,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/** Deletes an empty book and its account. A book with rounds is refused. */
export async function deleteInvestmentBook(token: string, bookId: string): Promise<ActionResult> {
  return runAction("deleteInvestmentBook", async () => {
    await requireAdmin(token);
    const rounds = await adminDb.collection(ROUNDS).where("bookId", "==", bookId).limit(1).get();
    if (!rounds.empty) {
      throw new UserFacingError("This book still has rounds in it. Delete those first.");
    }
    const accountRef = adminDb.collection(ACCOUNTS).doc(investmentAccountId(bookId));
    const movements = await adminDb
      .collection(TRANSACTIONS)
      .where("accountId", "==", investmentAccountId(bookId))
      .limit(1)
      .get();
    const batch = adminDb.batch();
    batch.delete(adminDb.collection(BOOKS).doc(bookId));
    // The account goes with the book only when nothing was ever paid out of it —
    // otherwise its statement is history somebody may need.
    if (movements.empty) batch.delete(accountRef);
    await batch.commit();
  });
}

/* -------------------------------------------------------------------------- */
/* Rounds                                                                      */
/* -------------------------------------------------------------------------- */

export interface InvestmentRoundInput {
  bookId: string;
  /** `AMOUNT`. */
  amount: number;
  /** `DATE`. */
  dayKey?: string | null;
  /** `RETURN DATE`. The day the profit is banked, when there is one. */
  returnDayKey?: string | null;
  /** `PROFIT`. */
  profit: number;
  /** `GROSS PROFIT`. */
  grossProfit?: number;
  /** Column key → rupees. */
  shares?: Record<string, number>;
  /** `DESCRIPTION` — where the net went. */
  description?: string | null;
  /**
   * The account(s) the amount was taken out of. One line takes the whole
   * amount; several must add up to it. Empty leaves it a figure on the sheet.
   */
  funding?: Array<{ accountId: string; amount: number | string }>;
  /**
   * Whether the partner has paid it back. Omitted on an edit keeps what the
   * round already was; a new round is not received unless this says so.
   */
  received?: boolean;
  /** The day it arrived. Defaults to today when `received` is set. */
  receivedDayKey?: string | null;
}

export async function saveInvestmentRound(
  token: string,
  input: InvestmentRoundInput,
  roundId?: string
): Promise<ActionResult<{ roundId: string; netProfit: number; received: boolean }>> {
  return runAction("saveInvestmentRound", async () => {
    const auth = await requireFinance(token);

    const bookSnap = await adminDb.collection(BOOKS).doc(input.bookId).get();
    if (!bookSnap.exists) throw new UserFacingError("That book no longer exists.");
    const book = bookSnap.data()!;
    const columns = readShareColumns(book.columns);
    const netBasis = normalizeNetBasis(book.netBasis);

    const figures = calculateRound(
      {
        amount: input.amount,
        profit: input.profit,
        grossProfit: input.grossProfit ?? input.profit,
        shares: input.shares ?? {},
      },
      columns,
      netBasis
    );
    if (figures.amount <= 0) throw new UserFacingError("Enter the amount invested.");

    const dayKey = dayOrNull(input.dayKey) ?? karachiDayKey();
    const returnDayKey = dayOrNull(input.returnDayKey);
    if (returnDayKey && returnDayKey < dayKey) {
      throw new UserFacingError("The return date is before the date the money went in.");
    }

    const funding = checkRoundFunding(figures.amount, input.funding ?? []);
    if (!funding.valid) throw new UserFacingError(funding.errors[0]);

    const bookName = (book.name as string) ?? "Investment";
    const partner = (book.partner as string) || "the partner";

    const ref = roundId ? adminDb.collection(ROUNDS).doc(roundId) : adminDb.collection(ROUNDS).doc();
    const payload = {
      bookId: input.bookId,
      amount: figures.amount,
      dayKey,
      returnDayKey,
      profit: figures.profit,
      grossProfit: figures.grossProfit,
      shares: figures.shares,
      totalShares: figures.totalShares,
      netProfit: figures.netProfit,
      description: (input.description ?? "").trim() || null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };

    const received = await adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (roundId && !snap.exists) throw new UserFacingError("That round no longer exists.");
      if (roundId && snap.data()?.bookId !== input.bookId) {
        throw new UserFacingError("That round belongs to a different book.");
      }

      // A new round is money still out with the partner; an edit keeps whatever
      // the round already was unless the form says otherwise.
      const existing = snap.exists ? snap.data()! : null;
      const isReceived = input.received ?? (existing ? isRoundReceived(existing) : false);
      const receivedDayKey = isReceived
        ? dayOrNull(input.receivedDayKey) ?? (existing ? receivedDayFor(existing) : null) ?? karachiDayKey()
        : null;
      if (receivedDayKey && receivedDayKey < dayKey) {
        throw new UserFacingError("The received date is before the date the money went in.");
      }

      const previousLines = existing ? readFunding(existing.funding) : [];
      const state = await readRoundLedger(t, ref.id, input.bookId, previousLines, funding.lines, dayKey, receivedDayKey);

      // Unticking Received takes the net back out; an account cannot un-spend.
      if (existing && isRoundReceived(existing) && !isReceived) {
        const change = roundLedgerDeltas(state, figures.netProfit, false, input.bookId).get(investmentAccountId(input.bookId)) ?? 0;
        const balance = money(state.bookAccount.data()?.cachedBalance);
        if (change < 0 && balance + change < 0) {
          throw new UserFacingError(
            `${bookName}'s account holds ${formatMoney(balance)}, less than the ${formatMoney(-change)} this round banked — some of it has already been spent. Remove those payments first.`
          );
        }
      }

      const wasOnRound = new Set(previousLines.map((line) => line.accountId));
      for (const line of funding.lines) {
        const account = state.accounts.get(line.accountId);
        if (!account?.exists) {
          throw new UserFacingError("One of the accounts this round is taken from no longer exists. Choose another.");
        }
        if (account.data()?.status === "ARCHIVED" && !wasOnRound.has(line.accountId)) {
          throw new UserFacingError(`${account.data()?.name ?? "That account"} is archived and cannot be paid from.`);
        }
      }

      const entry = {
        at: new Date().toISOString(),
        action: roundId ? "EDITED" : "CREATED",
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        amount: figures.netProfit,
        funding: funding.lines,
        received: isReceived,
      };
      const stored = {
        ...payload,
        received: isReceived,
        receivedDayKey,
        // The name is frozen beside the id, so a renamed or deleted account
        // still reads as what it was when the money left it.
        funding: funding.lines.map((line) => ({
          ...line,
          accountName: (state.accounts.get(line.accountId)?.data()?.name as string) ?? null,
        })),
      };
      t.set(
        ref,
        roundId
          ? { ...stored, history: FieldValue.arrayUnion(entry) }
          : { ...stored, createdByUid: auth.uid, createdAt: FieldValue.serverTimestamp(), history: [entry] },
        { merge: Boolean(roundId) }
      );

      writeRoundLedger(t, state, {
        roundId: ref.id,
        bookId: input.bookId,
        bookName,
        partner,
        amount: figures.amount,
        description: payload.description,
        netProfit: figures.netProfit,
        received: isReceived,
        auth,
      });
      return isReceived;
    });

    return { roundId: ref.id, netProfit: figures.netProfit, received };
  });
}

/* -------------------------------------------------------------------------- */
/* What a round has posted, and what it should have posted                     */
/* -------------------------------------------------------------------------- */

interface RoundLedgerState {
  legs: FundingLeg[];
  legSnaps: FirebaseFirestore.DocumentSnapshot[];
  accounts: Map<string, FirebaseFirestore.DocumentSnapshot>;
  profitSnap: FirebaseFirestore.DocumentSnapshot;
  bookAccount: FirebaseFirestore.DocumentSnapshot;
  receivedDayKey: string | null;
}

/**
 * Every read a round's ledger needs, done before any write in the transaction.
 *
 * **What is already posted is read back from the ledger**, not from the round:
 * a leg somebody deleted from a statement must not be taken off its account a
 * second time. The capital's return leg exists only once the round is received.
 */
async function readRoundLedger(
  t: FirebaseFirestore.Transaction,
  roundId: string,
  bookId: string,
  previousLines: FundingLine[],
  lines: FundingLine[],
  dayKey: string,
  receivedDayKey: string | null
): Promise<RoundLedgerState> {
  const legs = fundingLegs(roundId, lines, dayKey, receivedDayKey);
  const legIds = [...new Set([...possibleFundingLegIds(roundId, previousLines), ...legs.map((leg) => leg.id)])];
  const accountIds = [...new Set([...previousLines, ...lines].map((line) => line.accountId))];
  const legSnaps = legIds.length ? await t.getAll(...legIds.map((id) => adminDb.collection(TRANSACTIONS).doc(id))) : [];
  const accountSnaps = accountIds.length ? await t.getAll(...accountIds.map((id) => adminDb.collection(ACCOUNTS).doc(id))) : [];
  const [profitSnap, bookAccount] = await t.getAll(
    adminDb.collection(TRANSACTIONS).doc(`invx_${roundId}`),
    adminDb.collection(ACCOUNTS).doc(investmentAccountId(bookId))
  );
  return {
    legs,
    legSnaps,
    accounts: new Map(accountSnaps.map((account) => [account.id, account])),
    profitSnap,
    bookAccount,
    receivedDayKey,
  };
}

/** How far each account's balance moves — capital legs and the net together. */
function roundLedgerDeltas(state: RoundLedgerState, netProfit: number, received: boolean, bookId: string): Map<string, number> {
  const posted = state.legSnaps
    .filter((leg) => leg.exists && leg.data()?.status === "POSTED")
    .map((leg) => ({
      accountId: leg.data()!.accountId as string,
      direction: leg.data()!.direction as "IN" | "OUT",
      amount: money(leg.data()!.amount),
    }));
  const deltas = fundingDeltas(posted, state.legs);
  const bookAccountId = investmentAccountId(bookId);
  const profitDelta =
    Math.round((roundProfitEffect(netProfit, received) - postedEffect(state.profitSnap.exists ? state.profitSnap.data() : null)) * 100) / 100;
  const combined = Math.round(((deltas.get(bookAccountId) ?? 0) + profitDelta) * 100) / 100;
  if (combined === 0) deltas.delete(bookAccountId);
  else deltas.set(bookAccountId, combined);
  return deltas;
}

/**
 * Writes the round's capital legs and its net, and moves every balance by the
 * difference — all in the caller's transaction.
 *
 * **The net is income only once the round is received**, dated the day it
 * arrived. Before that there is no profit row at all, not a zero one.
 */
function writeRoundLedger(
  t: FirebaseFirestore.Transaction,
  state: RoundLedgerState,
  round: {
    roundId: string;
    bookId: string;
    bookName: string;
    partner: string;
    amount: number;
    description: string | null;
    netProfit: number;
    received: boolean;
    auth: DecodedAuth;
  }
): void {
  const { roundId, bookId, bookName, partner, netProfit, received, auth } = round;
  const deltas = roundLedgerDeltas(state, netProfit, received, bookId);

  const keep = new Set(state.legs.map((leg) => leg.id));
  for (const leg of state.legSnaps) if (leg.exists && !keep.has(leg.id)) t.delete(leg.ref);

  const total = formatMoney(round.amount);
  for (const leg of state.legs) {
    t.set(
      adminDb.collection(TRANSACTIONS).doc(leg.id),
      {
        accountId: leg.accountId,
        direction: leg.direction,
        amount: leg.amount,
        type: "INVESTMENT",
        dayKey: leg.dayKey,
        sourceModule: "INVESTMENT_WITH_X",
        sourceId: roundId,
        sourceLabel:
          leg.kind === "OUT"
            ? `${bookName} — handed to ${partner} (${total} round)`
            : `${bookName} — back from ${partner} (${total} round)`,
        groupId: `invx_${roundId}`,
        status: "POSTED",
        note: round.description,
        idempotencyKey: `INVESTMENT_WITH_X:${leg.id}`,
        createdByUid: auth.uid,
        createdByName: auth.name ?? auth.email ?? null,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const profitRef = adminDb.collection(TRANSACTIONS).doc(`invx_${roundId}`);
  if (received && netProfit !== 0 && state.receivedDayKey) {
    t.set(profitRef, profitMovement(roundId, bookId, bookName, round.amount, round.description, netProfit, state.receivedDayKey, auth));
  } else if (state.profitSnap.exists) {
    t.delete(profitRef);
  }

  for (const [accountId, delta] of deltas) {
    const account = accountId === investmentAccountId(bookId) ? state.bookAccount : state.accounts.get(accountId);
    if (account?.exists) t.update(account.ref, { cachedBalance: FieldValue.increment(delta) });
  }
}

/**
 * Marks a round received — or, to correct a mistake, not received.
 *
 * Received banks the net into the book's account and puts the amount back into
 * the accounts it came from, both on `dayKey` (today by default). Not received
 * takes both back out, and is **refused once the book's account has spent
 * below it**, as deleting a round is: an account cannot un-spend.
 */
export async function setInvestmentRoundReceived(
  token: string,
  roundId: string,
  received: boolean,
  dayKey?: string | null
): Promise<ActionResult<{ netProfit: number; returned: number; receivedDayKey: string | null }>> {
  return runAction("setInvestmentRoundReceived", async () => {
    const auth = await requireFinance(token);
    const ref = adminDb.collection(ROUNDS).doc(roundId);

    return adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new UserFacingError("That round no longer exists.");
      const round = snap.data()!;
      const bookId = round.bookId as string;
      const bookSnap = await t.get(adminDb.collection(BOOKS).doc(bookId));
      if (!bookSnap.exists) throw new UserFacingError("That round's book no longer exists.");

      const startKey = dayOrNull(round.dayKey as string) ?? karachiDayKey();
      const receivedDayKey = received ? dayOrNull(dayKey) ?? karachiDayKey() : null;
      if (receivedDayKey && receivedDayKey < startKey) {
        throw new UserFacingError("The received date is before the date the money went in.");
      }

      const lines = readFunding(round.funding);
      const netProfit = money(round.netProfit);
      const state = await readRoundLedger(t, roundId, bookId, lines, lines, startKey, receivedDayKey);

      if (!received) {
        const change = roundLedgerDeltas(state, netProfit, false, bookId).get(investmentAccountId(bookId)) ?? 0;
        const balance = money(state.bookAccount.data()?.cachedBalance);
        if (change < 0 && balance + change < 0) {
          throw new UserFacingError(
            `${bookSnap.data()?.name ?? "This book"}'s account holds ${formatMoney(balance)}, less than the ${formatMoney(-change)} this round banked — some of it has already been spent. Remove those payments first.`
          );
        }
      }

      t.update(ref, {
        received,
        receivedDayKey,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: auth.uid,
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: received ? "RECEIVED" : "UNRECEIVED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          amount: netProfit,
          dayKey: receivedDayKey,
        }),
      });

      writeRoundLedger(t, state, {
        roundId,
        bookId,
        bookName: (bookSnap.data()?.name as string) ?? "Investment",
        partner: (bookSnap.data()?.partner as string) || "the partner",
        amount: money(round.amount),
        description: (round.description as string) || null,
        netProfit,
        received,
        auth,
      });

      const returned = lines.reduce((sum, line) => sum + line.amount, 0);
      return { netProfit, returned, receivedDayKey };
    });
  });
}

/**
 * Deletes a round, takes its net back out of the book's account, and undoes its
 * funding: money still out with the partner goes back into the accounts it came
 * from, and a round already returned leaves them where they are.
 *
 * **Refused once the account has spent below what this round put in**, as Car
 * Sale does — an account cannot un-spend, and the message says what to do.
 */
export async function deleteInvestmentRound(
  token: string,
  roundId: string
): Promise<ActionResult<{ reversed: number; restored: number }>> {
  return runAction("deleteInvestmentRound", async () => {
    await requireAdmin(token);

    const ref = adminDb.collection(ROUNDS).doc(roundId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That round no longer exists.");

    // What the round actually banked — nothing, if it was never received.
    const profitSnap = await adminDb.collection(TRANSACTIONS).doc(`invx_${roundId}`).get();
    const net = postedEffect(profitSnap.exists ? profitSnap.data() : null);
    const accountId = investmentAccountId(snap.data()?.bookId as string);
    const balance = money((await adminDb.collection(ACCOUNTS).doc(accountId).get()).data()?.cachedBalance);
    if (net > 0 && balance < net) {
      throw new UserFacingError(
        `This book's account holds ${formatMoney(balance)}, less than the ${formatMoney(net)} this round put in — some of it has already been spent. Remove those payments first, or edit the round instead of deleting it.`
      );
    }

    const legRefs = possibleFundingLegIds(roundId, readFunding(snap.data()?.funding)).map((id) =>
      adminDb.collection(TRANSACTIONS).doc(id)
    );
    const legSnaps = legRefs.length ? await adminDb.getAll(...legRefs) : [];
    const deltas = fundingDeltas(
      legSnaps
        .filter((leg) => leg.exists && leg.data()?.status === "POSTED")
        .map((leg) => ({
          accountId: leg.data()!.accountId as string,
          direction: leg.data()!.direction as "IN" | "OUT",
          amount: money(leg.data()!.amount),
        })),
      []
    );
    const fundingAccounts = deltas.size
      ? await adminDb.getAll(...[...deltas.keys()].map((id) => adminDb.collection(ACCOUNTS).doc(id)))
      : [];

    const batch = adminDb.batch();
    batch.delete(adminDb.collection(TRANSACTIONS).doc(`invx_${roundId}`));
    for (const leg of legSnaps) if (leg.exists) batch.delete(leg.ref);
    for (const account of fundingAccounts) {
      if (account.exists) batch.update(account.ref, { cachedBalance: FieldValue.increment(deltas.get(account.id)!) });
    }
    batch.delete(ref);
    await batch.commit();

    if (net !== 0) {
      await adminDb.collection(ACCOUNTS).doc(accountId).update({ cachedBalance: FieldValue.increment(-net) });
    }
    const restored = Math.round([...deltas.values()].reduce((sum, delta) => sum + delta, 0) * 100) / 100;
    return { reversed: net, restored };
  });
}
