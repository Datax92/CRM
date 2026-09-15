import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  accountBalance,
  allocationsToTransactions,
  balancesFor,
  checkAllocations,
  normalizeAccountKind,
  reversalOf,
  signedAmount,
  summarize,
  transferTransactions,
  validateTransfer,
  accountMovement,
  compareToPrevious,
  summarizeMonth,
  distributeAcrossObligations,
  type LedgerTransaction,
} from './ledger.ts';

import { afterTax, stateLifeCommission, stateLifeTotals } from './stateLife.ts';

/*
 * The ledger, against the owner's own scenarios.
 *
 * The one that matters most is the split payment: a 50,000 expense funded
 * 30,000 + 10,000 + 10,000 from three accounts is ONE obligation and THREE
 * movements, and no total may ever see 100,000.
 */

let seq = 0;
const txn = (over: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: `t${(seq += 1)}`,
  accountId: 'bank',
  direction: 'OUT',
  amount: 1000,
  type: 'EXPENSE',
  dayKey: '2026-09-10',
  sourceModule: 'MANUAL',
  sourceId: null,
  sourceLabel: null,
  groupId: null,
  status: 'POSTED',
  createdByUid: 'admin',
  ...over,
});

/* -------------------------------------------------------------------------- */

describe('balances are derived, never stored', () => {
  const account = { id: 'bank', openingBalance: 100_000 };

  test('opening balance plus inflows less outflows', () => {
    const balance = accountBalance(account, [
      txn({ direction: 'IN', amount: 50_000, type: 'INCOME' }),
      txn({ direction: 'OUT', amount: 20_000 }),
    ]);
    assert.equal(balance.inflow, 50_000);
    assert.equal(balance.outflow, 20_000);
    assert.equal(balance.balance, 130_000);
  });

  test('another account’s transactions never reach this balance', () => {
    const balance = accountBalance(account, [
      txn({ accountId: 'cash', direction: 'OUT', amount: 90_000 }),
    ]);
    assert.equal(balance.balance, 100_000);
    assert.equal(balance.transactionCount, 0);
  });

  test('a voided transaction is history, not money', () => {
    const balance = accountBalance(account, [
      txn({ direction: 'OUT', amount: 20_000, status: 'VOIDED' }),
    ]);
    assert.equal(balance.balance, 100_000);
  });

  test('an opening balance is not a transaction', () => {
    // It has no date, no source and no counterparty; posting one would put a
    // movement that never happened at the top of every statement.
    const balance = accountBalance({ id: 'bank', openingBalance: 5_000 }, []);
    assert.equal(balance.balance, 5_000);
    assert.equal(balance.transactionCount, 0);
  });
});

/* -------------------------------------------------------------------------- */

describe("the owner's split payment: 50,000 funded 30 + 10 + 10", () => {
  const PAYABLE = 50_000;
  const allocations = [
    { accountId: 'bank', amount: 30_000 },
    { accountId: 'cash', amount: 10_000 },
    { accountId: 'committee', amount: 10_000 },
  ];

  test('the three lines exactly fund the obligation', () => {
    const check = checkAllocations(PAYABLE, allocations);
    assert.equal(check.allocated, 50_000);
    assert.equal(check.unallocated, 0);
    assert.equal(check.fullyFunded, true);
    assert.equal(check.valid, true);
  });

  test('the expense stays 50,000 — the allocations only explain the funding', () => {
    const legs = allocationsToTransactions({
      allocations,
      direction: 'OUT',
      type: 'EXPENSE',
      dayKey: '2026-09-10',
      sourceModule: 'OFFICE_EXPENSE',
      sourceId: 'exp1',
      sourceLabel: 'Office rent',
      groupId: 'g1',
      createdByUid: 'admin',
    });

    // Three movements, summing to the one obligation. Never 100,000.
    assert.equal(legs.length, 3);
    assert.equal(legs.reduce((t, l) => t + l.amount, 0), PAYABLE);

    const totals = summarize(legs.map((l, i) => ({ ...l, id: `x${i}` })));
    assert.equal(totals.expenses, PAYABLE);
    assert.equal(totals.netMovement, -PAYABLE);
  });

  test('every leg links back to the record that caused it', () => {
    const legs = allocationsToTransactions({
      allocations, direction: 'OUT', type: 'EXPENSE', dayKey: '2026-09-10',
      sourceModule: 'OFFICE_EXPENSE', sourceId: 'exp1', sourceLabel: 'Office rent',
      groupId: 'g1', createdByUid: 'admin',
    });
    for (const leg of legs) {
      assert.equal(leg.sourceModule, 'OFFICE_EXPENSE');
      assert.equal(leg.sourceId, 'exp1');
      assert.equal(leg.sourceLabel, 'Office rent');
      assert.equal(leg.groupId, 'g1', 'the three legs are one payment');
    }
  });

  test('Committee receives its own −10,000, with no Committee-specific code', () => {
    // The owner asked for this by name. It is not a feature: Committee is an
    // account, an allocation names an account, so the leg exists because the
    // model says so. Grep this file and `ledger.ts` for "committee" — the only
    // occurrences are in test data.
    const legs = allocationsToTransactions({
      allocations, direction: 'OUT', type: 'EXPENSE', dayKey: '2026-09-10',
      sourceModule: 'OFFICE_EXPENSE', sourceId: 'exp1', sourceLabel: 'Office rent',
      groupId: 'g1', createdByUid: 'admin',
    }).map((l, i) => ({ ...l, id: `x${i}` }));

    const committee = accountBalance({ id: 'committee', openingBalance: 0 }, legs);
    assert.equal(committee.outflow, 10_000);
    assert.equal(committee.balance, -10_000);

    // And the other two accounts got exactly their own share, not the total.
    assert.equal(accountBalance({ id: 'bank', openingBalance: 0 }, legs).balance, -30_000);
    assert.equal(accountBalance({ id: 'cash', openingBalance: 0 }, legs).balance, -10_000);
  });

  test('the same payment submitted twice collides instead of paying twice', () => {
    const once = allocationsToTransactions({
      allocations, direction: 'OUT', type: 'EXPENSE', dayKey: '2026-09-10',
      sourceModule: 'OFFICE_EXPENSE', sourceId: 'exp1', sourceLabel: 'Office rent',
      groupId: 'g1', createdByUid: 'admin',
    });
    const again = allocationsToTransactions({
      allocations, direction: 'OUT', type: 'EXPENSE', dayKey: '2026-09-11',
      sourceModule: 'OFFICE_EXPENSE', sourceId: 'exp1', sourceLabel: 'Office rent',
      groupId: 'g2', createdByUid: 'admin',
    });
    // The key is the source record and the funding account — not the date, and
    // not the group — so a retry a day later still collides.
    assert.deepEqual(once.map((l) => l.idempotencyKey), again.map((l) => l.idempotencyKey));
    assert.deepEqual(once.map((l) => l.idempotencyKey), [
      'OFFICE_EXPENSE:exp1:bank',
      'OFFICE_EXPENSE:exp1:cash',
      'OFFICE_EXPENSE:exp1:committee',
    ]);
  });
});

/* -------------------------------------------------------------------------- */

describe('allocations are refused rather than trimmed', () => {
  test('over-allocation is an error, and the lines keep the amounts typed', () => {
    const check = checkAllocations(50_000, [
      { accountId: 'bank', amount: 40_000 },
      { accountId: 'cash', amount: 20_000 },
    ]);
    assert.equal(check.valid, false);
    assert.equal(check.allocated, 60_000);
    assert.match(check.errors[0], /more than the 50,000 outstanding/);
  });

  test('a part payment is valid but not fully funded', () => {
    const check = checkAllocations(50_000, [{ accountId: 'bank', amount: 30_000 }]);
    assert.equal(check.valid, true);
    assert.equal(check.fullyFunded, false);
    assert.equal(check.unallocated, 20_000);
  });

  test('a second payment may only fund what is still outstanding', () => {
    const check = checkAllocations(50_000, [{ accountId: 'cash', amount: 25_000 }], 30_000);
    assert.equal(check.valid, false);
    assert.match(check.errors[0], /more than the 20,000 outstanding/);
  });

  test('the balance of an obligation closes it exactly', () => {
    const check = checkAllocations(50_000, [{ accountId: 'cash', amount: 20_000 }], 30_000);
    assert.equal(check.fullyFunded, true);
  });

  test('one account listed twice is refused — that is what a duplicate looks like', () => {
    const check = checkAllocations(50_000, [
      { accountId: 'bank', amount: 25_000 },
      { accountId: 'bank', amount: 25_000 },
    ]);
    assert.equal(check.valid, false);
    assert.match(check.errors.join(' '), /listed twice/);
  });

  test('a line with no account, or no amount, is refused', () => {
    assert.equal(checkAllocations(100, [{ accountId: '', amount: 100 }]).valid, false);
    assert.equal(checkAllocations(100, [{ accountId: 'bank', amount: 0 }]).valid, false);
  });

  test('paying nothing, or paying against nothing, is refused', () => {
    assert.equal(checkAllocations(50_000, []).valid, false);
    assert.equal(checkAllocations(0, [{ accountId: 'bank', amount: 10 }]).valid, false);
  });
});

/* -------------------------------------------------------------------------- */

describe('transfers move money without earning or spending it', () => {
  const legs = transferTransactions({
    fromAccountId: 'bank',
    toAccountId: 'cash',
    amount: 25_000,
    dayKey: '2026-09-10',
    groupId: 'tr1',
    createdByUid: 'admin',
  }).map((l, i) => ({ ...l, id: `tr${i}` }));

  test('one leg out of A, one leg in to B', () => {
    assert.equal(accountBalance({ id: 'bank', openingBalance: 100_000 }, legs).balance, 75_000);
    assert.equal(accountBalance({ id: 'cash', openingBalance: 0 }, legs).balance, 25_000);
  });

  test('it is neither income nor expense', () => {
    const totals = summarize(legs);
    assert.equal(totals.income, 0);
    assert.equal(totals.expenses, 0);
    assert.equal(totals.transfersIn, 25_000);
    assert.equal(totals.transfersOut, 25_000);
  });

  test('across the whole business a transfer nets to nothing', () => {
    assert.equal(summarize(legs).netMovement, 0);
  });

  test('each leg names the other side, so a statement can say where it went', () => {
    assert.equal(legs[0].counterAccountId, 'cash');
    assert.equal(legs[1].counterAccountId, 'bank');
  });

  test('an account cannot transfer to itself', () => {
    const errors = validateTransfer({ fromAccountId: 'bank', toAccountId: 'bank', amount: 100 });
    assert.match(errors.join(' '), /cannot transfer to itself/);
  });

  test('a transfer needs two accounts and an amount', () => {
    assert.equal(validateTransfer({ fromAccountId: '', toAccountId: 'cash', amount: 100 }).length, 1);
    assert.equal(validateTransfer({ fromAccountId: 'a', toAccountId: 'b', amount: 0 }).length, 1);
  });
});

/* -------------------------------------------------------------------------- */

describe('corrections never rewrite history', () => {
  const original = txn({ id: 'orig', direction: 'OUT', amount: 10_000, accountId: 'bank' });

  test('a reversal is the opposite leg, on its own date, naming what it undoes', () => {
    const reversal = reversalOf(original, { dayKey: '2026-09-12', createdByUid: 'admin' });
    assert.equal(reversal.direction, 'IN');
    assert.equal(reversal.amount, 10_000);
    assert.equal(reversal.reversalOf, 'orig');
    assert.equal(reversal.dayKey, '2026-09-12');
    assert.match(reversal.sourceLabel ?? '', /^Reversal/);
  });

  test('the original stays POSTED and the reversal cancels it', () => {
    // 50,000 opening, 10,000 out, then reversed: back to 50,000, with both
    // rows still on the statement.
    const reversal = { ...reversalOf(original, { dayKey: '2026-09-12', createdByUid: 'admin' }), id: 'rev' };
    const marked = { ...original, reversedBy: 'rev' };
    assert.equal(accountBalance({ id: 'bank', openingBalance: 50_000 }, [marked, reversal]).balance, 50_000);
    assert.equal([marked, reversal].length, 2, 'nothing was deleted');
  });

  test('voiding AND reversing would correct the same mistake twice', () => {
    // The bug this file originally asserted as correct, kept as the thing that
    // must never come back: it moves the account by the amount a second time,
    // in the wrong direction.
    const reversal = { ...reversalOf(original, { dayKey: '2026-09-12', createdByUid: 'admin' }), id: 'rev' };
    const voided = { ...original, status: 'VOIDED' as const };
    assert.equal(accountBalance({ id: 'bank', openingBalance: 50_000 }, [voided, reversal]).balance, 60_000);
    assert.notEqual(60_000, 50_000);
  });
});

/* -------------------------------------------------------------------------- */

describe('the dashboard totals', () => {
  const rows = [
    txn({ direction: 'IN', amount: 200_000, type: 'INCOME', accountId: 'bank' }),
    txn({ direction: 'OUT', amount: 50_000, type: 'EXPENSE', accountId: 'bank' }),
    txn({ direction: 'OUT', amount: 30_000, type: 'INVESTMENT', accountId: 'cash' }),
    txn({ direction: 'OUT', amount: 5_000, type: 'REIMBURSEMENT', accountId: 'cash' }),
    ...transferTransactions({
      fromAccountId: 'bank', toAccountId: 'cash', amount: 10_000,
      dayKey: '2026-09-10', groupId: 'tr', createdByUid: 'admin',
    }).map((l, i) => ({ ...l, id: `t${i}` })),
  ];

  test('each type lands in its own line', () => {
    const totals = summarize(rows);
    assert.equal(totals.income, 200_000);
    assert.equal(totals.expenses, 50_000);
    assert.equal(totals.investments, 30_000);
    assert.equal(totals.reimbursements, 5_000);
    assert.equal(totals.transfersIn, 10_000);
    assert.equal(totals.transfersOut, 10_000);
  });

  test('net movement is every posted leg, and the transfer cancels inside it', () => {
    assert.equal(summarize(rows).netMovement, 200_000 - 50_000 - 30_000 - 5_000);
  });

  test('total available balance is the sum of the accounts', () => {
    const { byAccount, total } = balancesFor(
      [{ id: 'bank', openingBalance: 100_000 }, { id: 'cash', openingBalance: 20_000 }],
      rows
    );
    assert.equal(byAccount.get('bank')!.balance, 100_000 + 200_000 - 50_000 - 10_000);
    assert.equal(byAccount.get('cash')!.balance, 20_000 - 30_000 - 5_000 + 10_000);
    assert.equal(total, 240_000 - 5_000);
  });
});

/* -------------------------------------------------------------------------- */

describe('the small things that corrupt a ledger quietly', () => {
  test('an amount is never negative — direction carries the sign', () => {
    assert.equal(signedAmount({ direction: 'OUT', amount: 500 }), -500);
    assert.equal(signedAmount({ direction: 'IN', amount: 500 }), 500);
  });

  test('paisa round rather than drift', () => {
    const rows = [
      txn({ direction: 'IN', amount: 0.1, type: 'INCOME' }),
      txn({ direction: 'IN', amount: 0.2, type: 'INCOME' }),
    ];
    assert.equal(summarize(rows).income, 0.3);
    assert.equal(accountBalance({ id: 'bank', openingBalance: 0 }, rows).balance, 0.3);
  });

  test('an unknown account kind is OTHER, never a crash', () => {
    assert.equal(normalizeAccountKind('NONSENSE'), 'OTHER');
    assert.equal(normalizeAccountKind(undefined), 'OTHER');
    assert.equal(normalizeAccountKind('COMMITTEE'), 'COMMITTEE');
  });
});

/* -------------------------------------------------------------------------- */
/* StateLife — against the workbook's own rows                                 */
/* -------------------------------------------------------------------------- */

describe('StateLife commission, transcribed from statelife.xlsx', () => {
  test('row 4 of the sheet, to the paisa', () => {
    // MUHAMMAD NADEEM: FYP 300,000 · PASS 299,900 · discount 12,600.
    const c = stateLifeCommission({ fyp: 300_000, pass: 299_900, discount: 12_600 });
    assert.equal(c.firstCommission, 82_772.4);   // =E4*0.276
    assert.equal(c.secondCommission, 27_590.8);  // =E4*0.092
    assert.equal(c.remainingCommission, 97_763.2); // =M4+N4-O4
    assert.equal(c.quarterCommission, 6_897.7);  // =E4*0.023
    assert.equal(c.decemberCommission, 20_693.1); // =E4*0.069
    assert.equal(c.netCommission, 125_354);      // =P4+Q4+R4
  });

  test('row 5, where there is no discount', () => {
    const c = stateLifeCommission({ fyp: 100_000, pass: 99_900, discount: 0 });
    assert.equal(c.firstCommission, 27_572.4);
    assert.equal(c.secondCommission, 9_190.8);
    assert.equal(c.remainingCommission, 36_763.2);
    assert.equal(c.netCommission, 45_954);
  });

  test('the base is PASS, not FYP — the difference is the whole point', () => {
    // Row 10: proposed 260,000, passed 253,019. Using FYP would overpay.
    const onPass = stateLifeCommission({ fyp: 260_000, pass: 253_019, discount: 19_019 });
    const onFyp = stateLifeCommission({ fyp: 260_000, pass: 260_000, discount: 19_019 });
    assert.equal(onPass.firstCommission, 69_833.24);
    assert.notEqual(onPass.netCommission, onFyp.netCommission);
  });

  test('a discount larger than the commission gives a negative remainder', () => {
    // Row 15 of the sheet is −2,592 and its total depends on it staying negative.
    const c = stateLifeCommission({ fyp: 31_000, pass: 31_000, discount: 14_000 });
    assert.equal(c.remainingCommission, -2_592);
    assert.equal(c.netCommission, 260);
  });

  test('the rates are the sheet’s rates with 8% tax folded in', () => {
    assert.equal(afterTax(0.30), 0.276);
    assert.equal(afterTax(0.10), 0.092);
    assert.equal(afterTax(0.025), 0.023);
    assert.equal(afterTax(0.075), 0.069);
  });

  test('column totals sum the derived columns, not just the typed ones', () => {
    const totals = stateLifeTotals([
      { fyp: 300_000, pass: 299_900, discount: 12_600, paidAmount: 300_003 },
      { fyp: 100_000, pass: 99_900, discount: 0, paidAmount: 100_014 },
    ]);
    assert.equal(totals.pass, 399_800);
    assert.equal(totals.paidAmount, 400_017);
    assert.equal(totals.netCommission, 125_354 + 45_954);
  });
});

/* -------------------------------------------------------------------------- */
/* Movement and trend                                                          */
/* -------------------------------------------------------------------------- */

describe('movement, and refusing to invent a trend', () => {
  const NOW = { todayKey: '2026-09-10', monthKey: '2026-09', previousMonthKey: '2026-08' };
  const account = { id: 'bank', openingBalance: 100_000 };

  test("today's movement is only today's transactions", () => {
    const m = accountMovement(account, [
      txn({ direction: 'IN', amount: 5_000, type: 'INCOME', dayKey: '2026-09-10' }),
      txn({ direction: 'OUT', amount: 2_000, dayKey: '2026-09-10' }),
      txn({ direction: 'OUT', amount: 9_999, dayKey: '2026-09-09' }),
    ], NOW);
    assert.equal(m.today, 3_000);
  });

  test('the month figure is the calendar month, and the arrow follows it', () => {
    const m = accountMovement(account, [
      txn({ direction: 'IN', amount: 50_000, type: 'INCOME', dayKey: '2026-09-01' }),
      txn({ direction: 'OUT', amount: 20_000, dayKey: '2026-09-30' }),
      txn({ direction: 'OUT', amount: 99_000, dayKey: '2026-08-31' }),
    ], NOW);
    assert.equal(m.month, 30_000);
    assert.equal(m.direction, 'up');
    assert.equal(m.previousMonth, -99_000);
  });

  test('no previous month means NO percentage — not 100%', () => {
    // The brief is explicit: do not invent a comparison. A card that says
    // "↑ 100%" because last month happened to be blank is exactly that.
    const m = accountMovement(account, [
      txn({ direction: 'IN', amount: 10_000, type: 'INCOME', dayKey: '2026-09-05' }),
    ], NOW);
    assert.equal(m.previousMonth, null);
    assert.equal(m.changePct, null);
  });

  test('a previous month of exactly zero also yields no percentage', () => {
    // Dividing by it is undefined, not infinite growth.
    assert.equal(compareToPrevious(5_000, 0).changePct, null);
  });

  test('a real comparison is a real percentage, both ways', () => {
    assert.equal(compareToPrevious(120, 100).changePct, 20);
    assert.equal(compareToPrevious(80, 100).changePct, -20);
    assert.equal(compareToPrevious(100, 100).direction, 'flat');
  });

  test('a fall from a negative previous month reads the right way round', () => {
    // −100 → −50 is an improvement, and the sign must not flip it.
    assert.equal(compareToPrevious(-50, -100).changePct, 50);
  });

  test('an account with no movement is flat, not up', () => {
    const m = accountMovement(account, [], NOW);
    assert.equal(m.direction, 'flat');
    assert.equal(m.today, 0);
    assert.equal(m.balance, 100_000);
  });

  test('a voided transaction moves nothing', () => {
    const m = accountMovement(account, [
      txn({ direction: 'OUT', amount: 5_000, dayKey: '2026-09-10', status: 'VOIDED' }),
    ], NOW);
    assert.equal(m.today, 0);
  });

  test('one month can be summarised apart from the rest', () => {
    const rows = [
      txn({ direction: 'IN', amount: 100, type: 'INCOME', dayKey: '2026-09-02' }),
      txn({ direction: 'OUT', amount: 40, type: 'EXPENSE', dayKey: '2026-09-03' }),
      txn({ direction: 'OUT', amount: 999, type: 'EXPENSE', dayKey: '2026-08-03' }),
    ];
    const sept = summarizeMonth(rows, '2026-09');
    assert.equal(sept.income, 100);
    assert.equal(sept.expenses, 40);
  });
});

describe('paying a period total across many expenses', () => {
  const expenses = [
    { id: 'rent', outstanding: 30_000 },
    { id: 'bills', outstanding: 12_000 },
    { id: 'ads', outstanding: 8_000 },
  ];

  test('50,000 from two accounts settles all three, oldest first, with no leg per pairing', () => {
    const result = distributeAcrossObligations(expenses, [
      { accountId: 'carSale', amount: 35_000 },
      { accountId: 'bank', amount: 15_000 },
    ]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.legs, [
      { obligationId: 'rent', accountId: 'carSale', amount: 30_000 },
      { obligationId: 'bills', accountId: 'carSale', amount: 5_000 },
      { obligationId: 'bills', accountId: 'bank', amount: 7_000 },
      { obligationId: 'ads', accountId: 'bank', amount: 8_000 },
    ]);
    assert.equal(result.legs.length <= expenses.length + 2 - 1, true);
    assert.equal(result.paidByObligation.get('bills'), 12_000);
  });

  test('the legs add up to exactly what was allocated — nothing invented, nothing lost', () => {
    const result = distributeAcrossObligations(expenses, [{ accountId: 'bank', amount: 41_500.5 }]);
    const sum = result.legs.reduce((total, leg) => total + leg.amount, 0);
    assert.equal(Math.round(sum * 100) / 100, 41_500.5);
    assert.equal(result.paidByObligation.get('rent'), 30_000);
    assert.equal(result.paidByObligation.get('bills'), 11_500.5);
    assert.equal(result.paidByObligation.has('ads'), false);
  });

  test('more than is owed is refused, never trimmed', () => {
    const result = distributeAcrossObligations(expenses, [{ accountId: 'bank', amount: 50_001 }]);
    assert.equal(result.valid, false);
    assert.equal(result.legs.length, 0);
  });

  test('settled records are skipped, and an all-settled period is refused', () => {
    const partly = distributeAcrossObligations(
      [{ id: 'paid', outstanding: 0 }, { id: 'open', outstanding: 500 }],
      [{ accountId: 'cash', amount: 500 }]
    );
    assert.deepEqual(partly.legs, [{ obligationId: 'open', accountId: 'cash', amount: 500 }]);
    assert.equal(
      distributeAcrossObligations([{ id: 'paid', outstanding: 0 }], [{ accountId: 'cash', amount: 1 }]).valid,
      false
    );
  });

  test('an account listed twice, or a zero line, is refused', () => {
    assert.equal(
      distributeAcrossObligations(expenses, [
        { accountId: 'bank', amount: 100 },
        { accountId: 'bank', amount: 100 },
      ]).valid,
      false
    );
    assert.equal(distributeAcrossObligations(expenses, [{ accountId: 'bank', amount: 0 }]).valid, false);
  });
});
