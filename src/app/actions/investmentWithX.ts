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
 * on its return date (`lib/investmentWithX.checkRoundFunding`). The share
 * columns are facts on the sheet, not movements.
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
  normalizeNetBasis,
  normalizeShareColumns,
  possibleFundingLegIds,
  readFunding,
  readShareColumns,
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
    const before = money(data.netProfit);
    if (before === figures.netProfit) continue;
    await doc.ref.update({ netProfit: figures.netProfit, totalShares: figures.totalShares });
    await writeRoundMovement(doc.id, bookId, bookName, data, figures.netProfit, auth);
    delta += figures.netProfit - before;
    count += 1;
  }
  const rounded = Math.round(delta * 100) / 100;
  if (rounded !== 0) {
    await adminDb.collection(ACCOUNTS).doc(investmentAccountId(bookId)).update({
      cachedBalance: FieldValue.increment(rounded),
    });
  }
  return count;
}

/** The one ledger row a round owns. A loss is an `OUT` leg of its absolute value. */
async function writeRoundMovement(
  roundId: string,
  bookId: string,
  bookName: string,
  round: Record<string, unknown>,
  netProfit: number,
  auth: DecodedAuth
): Promise<void> {
  const dayKey = dayOrNull(round.returnDayKey as string) ?? dayOrNull(round.dayKey as string) ?? karachiDayKey();
  const amount = formatMoney(money(round.amount));
  await adminDb.collection(TRANSACTIONS).doc(`invx_${roundId}`).set({
    accountId: investmentAccountId(bookId),
    direction: netProfit < 0 ? "OUT" : "IN",
    amount: Math.abs(netProfit),
    type: netProfit < 0 ? "EXPENSE" : "INCOME",
    dayKey,
    sourceModule: "INVESTMENT_WITH_X",
    sourceId: roundId,
    sourceLabel: `${bookName} — ${amount} round${netProfit < 0 ? " at a loss" : ""}`,
    groupId: null,
    status: "POSTED",
    note: (round.description as string) || null,
    idempotencyKey: `INVESTMENT_WITH_X:${roundId}:${investmentAccountId(bookId)}`,
    createdByUid: auth.uid,
    createdByName: auth.name ?? auth.email ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
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
}

export async function saveInvestmentRound(
  token: string,
  input: InvestmentRoundInput,
  roundId?: string
): Promise<ActionResult<{ roundId: string; netProfit: number }>> {
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

    const previousNet = await adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (roundId && !snap.exists) throw new UserFacingError("That round no longer exists.");
      if (roundId && snap.data()?.bookId !== input.bookId) {
        throw new UserFacingError("That round belongs to a different book.");
      }

      // **What the funding has actually posted is read back from the ledger**,
      // not from the round: a leg somebody deleted from a statement must not be
      // taken off its account a second time.
      const previousLines = snap.exists ? readFunding(snap.data()?.funding) : [];
      const legs = fundingLegs(ref.id, funding.lines, dayKey, returnDayKey);
      const legIds = [...new Set([...possibleFundingLegIds(ref.id, previousLines), ...legs.map((leg) => leg.id)])];
      const accountIds = [...new Set([...previousLines, ...funding.lines].map((line) => line.accountId))];
      const legSnaps = legIds.length
        ? await t.getAll(...legIds.map((id) => adminDb.collection(TRANSACTIONS).doc(id)))
        : [];
      const accountSnaps = accountIds.length
        ? await t.getAll(...accountIds.map((id) => adminDb.collection(ACCOUNTS).doc(id)))
        : [];
      const accounts = new Map(accountSnaps.map((account) => [account.id, account]));

      const wasOnRound = new Set(previousLines.map((line) => line.accountId));
      for (const line of funding.lines) {
        const account = accounts.get(line.accountId);
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
      };
      const stored = {
        ...payload,
        // The name is frozen beside the id, so a renamed or deleted account
        // still reads as what it was when the money left it.
        funding: funding.lines.map((line) => ({
          ...line,
          accountName: (accounts.get(line.accountId)?.data()?.name as string) ?? null,
        })),
      };
      t.set(
        ref,
        roundId
          ? { ...stored, history: FieldValue.arrayUnion(entry) }
          : { ...stored, createdByUid: auth.uid, createdAt: FieldValue.serverTimestamp(), history: [entry] },
        { merge: Boolean(roundId) }
      );

      const posted = legSnaps
        .filter((leg) => leg.exists && leg.data()?.status === "POSTED")
        .map((leg) => ({
          accountId: leg.data()!.accountId as string,
          direction: leg.data()!.direction as "IN" | "OUT",
          amount: money(leg.data()!.amount),
        }));
      const keep = new Set(legs.map((leg) => leg.id));
      for (const leg of legSnaps) if (leg.exists && !keep.has(leg.id)) t.delete(leg.ref);

      const total = formatMoney(figures.amount);
      for (const leg of legs) {
        t.set(
          adminDb.collection(TRANSACTIONS).doc(leg.id),
          {
            accountId: leg.accountId,
            direction: leg.direction,
            amount: leg.amount,
            type: "INVESTMENT",
            dayKey: leg.dayKey,
            sourceModule: "INVESTMENT_WITH_X",
            sourceId: ref.id,
            sourceLabel:
              leg.kind === "OUT"
                ? `${bookName} — handed to ${partner} (${total} round)`
                : `${bookName} — back from ${partner} (${total} round)`,
            groupId: `invx_${ref.id}`,
            status: "POSTED",
            note: payload.description,
            idempotencyKey: `INVESTMENT_WITH_X:${leg.id}`,
            createdByUid: auth.uid,
            createdByName: auth.name ?? auth.email ?? null,
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      // Each account moves by the difference, in the same transaction.
      for (const [accountId, delta] of fundingDeltas(posted, legs)) {
        const account = accounts.get(accountId);
        if (account?.exists) t.update(account.ref, { cachedBalance: FieldValue.increment(delta) });
      }

      return snap.exists ? money(snap.data()?.netProfit) : 0;
    });

    await writeRoundMovement(ref.id, input.bookId, bookName, payload, figures.netProfit, auth);

    const delta = Math.round((figures.netProfit - previousNet) * 100) / 100;
    if (delta !== 0) {
      await adminDb.collection(ACCOUNTS).doc(investmentAccountId(input.bookId)).update({
        cachedBalance: FieldValue.increment(delta),
      });
    }

    return { roundId: ref.id, netProfit: figures.netProfit };
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

    const net = money(snap.data()?.netProfit);
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
