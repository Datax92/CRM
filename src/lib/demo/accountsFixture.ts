/**
 * Sample rows for the Accounts section in demo mode.
 *
 * Every Accounts screen reads through `useLive`, keyed by collection, so this
 * is one table of rows per key rather than a branch in each hook. It is
 * read-only: the writes go through Server Actions, which a demo deployment has
 * no database behind (`runAction` says so in plain words).
 *
 * The figures hang together the way the real ledger does — a round's capital
 * leaves the account named in its funding and comes back on receipt, a
 * committee's spendings are its OUT legs, an Amanat receipt is one IN row on
 * the Amanat account — so the balances, the statements and the sheets agree.
 */

type Row = Record<string, unknown> & { id: string };

const by = { createdByUid: 'demo-admin', createdByName: 'Usman Sheikh' };

const accounts: Row[] = [
  { id: 'acc_meezan', name: 'Meezan Bank — Current', kind: 'BANK', openingBalance: 2_500_000, status: 'ACTIVE' },
  { id: 'acc_hbl', name: 'HBL — Business', kind: 'BANK', openingBalance: 1_200_000, status: 'ACTIVE' },
  { id: 'acc_cash', name: 'Cash in Hand', kind: 'CASH', openingBalance: 350_000, status: 'ACTIVE' },
  { id: 'acc_jazz', name: 'JazzCash', kind: 'WALLET', openingBalance: 60_000, status: 'ACTIVE' },
  { id: 'acc_committee_dec', name: 'December Committee', kind: 'COMMITTEE', openingBalance: 600_000, status: 'ACTIVE' },
  { id: 'acc_partner_a', name: 'Capital — Partner A', kind: 'INVESTMENT', openingBalance: 0, status: 'ACTIVE' },
  { id: 'acc_card_ubl', name: 'UBL Credit Card', kind: 'INVESTMENT', openingBalance: 0, status: 'ACTIVE' },
  { id: 'acc_marketing', name: 'Marketing Income', kind: 'INCOME', openingBalance: 0, status: 'ACTIVE' },
  { id: 'invx_book_plots', name: 'Investment with X — Plot Flips', kind: 'INCOME', openingBalance: 0, status: 'ACTIVE' },
  { id: 'amanat_main', name: 'Amanat', kind: 'AMANAT', openingBalance: 0, status: 'ACTIVE' },
].sort((a, b) => String(a.name).localeCompare(String(b.name)));

function txn(
  id: string,
  accountId: string,
  direction: 'IN' | 'OUT',
  amount: number,
  type: string,
  dayKey: string,
  sourceModule: string,
  sourceLabel: string,
  extra: Record<string, unknown> = {}
): Row {
  return {
    id, accountId, direction, amount, type, dayKey, sourceModule, sourceLabel,
    sourceId: extra.sourceId ?? null, groupId: extra.groupId ?? null, status: 'POSTED', note: null,
    ...by, ...extra,
  };
}

const transactions: Row[] = [
  // The committee pot (600,000 collected, its opening balance) pays for things.
  txn('t02', 'acc_committee_dec', 'OUT', 85_000, 'EXPENSE', '2026-09-12', 'MANUAL', 'Office furniture'),
  txn('t03', 'acc_committee_dec', 'OUT', 40_000, 'EXPENSE', '2026-10-03', 'OFFICE_EXPENSE', 'Office rent (part)', { sourceId: 'demo-exp-1', groupId: 'g_rent' }),
  txn('t04', 'acc_meezan', 'OUT', 110_000, 'EXPENSE', '2026-10-03', 'OFFICE_EXPENSE', 'Office rent (part)', { sourceId: 'demo-exp-1', groupId: 'g_rent' }),
  // Partner capital in, and spent on a plot down payment.
  txn('t05', 'acc_partner_a', 'IN', 2_000_000, 'INVESTMENT', '2026-08-20', 'CAPITAL_INVESTMENT', 'Partner A — capital'),
  txn('t06', 'acc_partner_a', 'OUT', 750_000, 'EXPENSE', '2026-09-05', 'CAPITAL_INVESTMENT', 'Plot token — Bahria Phase 8', { sourceId: 'cs_1' }),
  // Marketing income lands.
  txn('t07', 'acc_marketing', 'IN', 180_000, 'INCOME', '2026-09-18', 'MARKETING_INCOME', 'Gulberg Heights — campaign fee', { sourceId: 'mi_1' }),
  txn('t08', 'acc_marketing', 'IN', 95_000, 'INCOME', '2026-10-06', 'MARKETING_INCOME', 'Lake City — lead package', { sourceId: 'mi_2' }),
  // Investment with X: capital out and back, and the net banked.
  txn('t09', 'acc_meezan', 'OUT', 500_000, 'INVESTMENT', '2026-08-01', 'INVESTMENT_WITH_X', 'Plot flip — round 1 out', { sourceId: 'r1' }),
  txn('t10', 'acc_meezan', 'IN', 500_000, 'INVESTMENT', '2026-09-01', 'INVESTMENT_WITH_X', 'Plot flip — round 1 back', { sourceId: 'r1' }),
  txn('t11', 'invx_book_plots', 'IN', 52_000, 'INCOME', '2026-09-01', 'INVESTMENT_WITH_X', 'Plot flip — round 1 net', { sourceId: 'r1' }),
  txn('t12', 'acc_hbl', 'OUT', 800_000, 'INVESTMENT', '2026-09-10', 'INVESTMENT_WITH_X', 'Plot flip — round 2 out', { sourceId: 'r2' }),
  txn('t13', 'acc_meezan', 'OUT', 650_000, 'INVESTMENT', '2026-09-25', 'INVESTMENT_WITH_X', 'Plot flip — round 3 out', { sourceId: 'r3' }),
  // A transfer, both legs.
  txn('t14', 'acc_meezan', 'OUT', 100_000, 'TRANSFER', '2026-10-02', 'MANUAL', 'Transfer to cash', { groupId: 'g_tr1', counterAccountId: 'acc_cash' }),
  txn('t15', 'acc_cash', 'IN', 100_000, 'TRANSFER', '2026-10-02', 'MANUAL', 'Transfer from Meezan', { groupId: 'g_tr1', counterAccountId: 'acc_meezan' }),
  // Amanat held on trust, part of it used.
  txn('t16', 'amanat_main', 'IN', 300_000, 'LOAN', '2026-09-15', 'AMANAT', 'Amanat — Haji Rasheed', { sourceId: 'am_1' }),
  txn('t17', 'amanat_main', 'IN', 150_000, 'LOAN', '2026-10-01', 'AMANAT', 'Amanat — Saima Bibi', { sourceId: 'am_2' }),
  txn('t18', 'amanat_main', 'OUT', 60_000, 'EXPENSE', '2026-10-04', 'OFFICE_EXPENSE', 'Generator repair', { sourceId: 'demo-exp-2' }),
  // A receivable settling into the bank.
  txn('t19', 'acc_meezan', 'IN', 200_000, 'LOAN', '2026-09-28', 'RECEIVABLE', 'Received — Imran Traders', { sourceId: 'rv_1' }),
  // Day-to-day.
  txn('t20', 'acc_cash', 'OUT', 18_500, 'EXPENSE', '2026-10-07', 'MANUAL', 'Fuel and tea'),
  txn('t21', 'acc_jazz', 'OUT', 12_000, 'EXPENSE', '2026-10-08', 'MANUAL', 'Mobile packages'),
  txn('t22', 'acc_hbl', 'IN', 450_000, 'INCOME', '2026-10-09', 'DEAL_PAYOUT', 'Deal — DHA Phase 6 down payment'),
  // A credit card covers a month's shortfall, and part of it is paid back
  // from Marketing Income: the spending stays 249,000, and the pay-back is a
  // pair of TRANSFER legs naming it (`payBackSpending`).
  txn('t23', 'acc_card_ubl', 'IN', 950_000, 'INVESTMENT', '2026-09-01', 'MANUAL', 'Card limit'),
  txn('t24', 'acc_card_ubl', 'OUT', 249_000, 'EXPENSE', '2026-09-30', 'MANUAL', 'Shortfall till 30 September', {
    paidBack: 77_000,
    paidBackStatus: 'PART_PAID_BACK',
    history: [{
      at: '2026-10-16T10:20:00.000Z', action: 'PAID_BACK', byName: by.createdByName, amount: 77_000,
      allocations: [{ accountId: 'acc_marketing', accountName: 'Marketing Income', amount: 77_000 }],
    }],
  }),
  txn('t25', 'acc_marketing', 'OUT', 77_000, 'TRANSFER', '2026-10-16', 'PAY_BACK', 'Paid back to UBL Credit Card — Shortfall till 30 September', { sourceId: 't24', groupId: 'g_pb1', counterAccountId: 'acc_card_ubl' }),
  txn('t26', 'acc_card_ubl', 'IN', 77_000, 'TRANSFER', '2026-10-16', 'PAY_BACK', 'Paid back from Marketing Income — Shortfall till 30 September', { sourceId: 't24', groupId: 'g_pb1', counterAccountId: 'acc_marketing' }),
].sort((a, b) => String(b.dayKey).localeCompare(String(a.dayKey)));

const investmentBooks: Row[] = [
  { id: 'book_plots', name: 'Plot Flips', partner: 'Kamran Ali', netBasis: 'PROFIT', accountId: 'invx_book_plots',
    description: 'Short plot flips in Bahria Town with Kamran.',
    columns: [{ key: 'investor', label: 'INVESTOR' }, { key: 'cc', label: 'CC' }, { key: 'misc', label: 'MISC' }] },
];

const investmentRounds: Row[] = [
  { id: 'r1', bookId: 'book_plots', dayKey: '2026-08-01', returnDayKey: '2026-09-01', amount: 500_000, profit: 80_000, grossProfit: 80_000,
    shares: { investor: 20_000, cc: 5_000, misc: 3_000 }, received: true, receivedDayKey: '2026-09-01',
    funding: [{ accountId: 'acc_meezan', amount: 500_000 }], description: 'Plot 112, Sector C' },
  { id: 'r2', bookId: 'book_plots', dayKey: '2026-09-10', returnDayKey: '2026-10-05', amount: 800_000, profit: 120_000, grossProfit: 120_000,
    shares: { investor: 30_000, cc: 8_000, misc: 2_000 }, received: false,
    funding: [{ accountId: 'acc_hbl', amount: 800_000 }], description: 'Plot 47, Sector F — buyer delayed' },
  { id: 'r3', bookId: 'book_plots', dayKey: '2026-09-25', returnDayKey: '2026-11-01', amount: 650_000, profit: 95_000, grossProfit: 95_000,
    shares: { investor: 25_000, cc: 6_000, misc: 1_500 }, received: false,
    funding: [{ accountId: 'acc_meezan', amount: 650_000 }], description: 'Commercial file, Precinct 12' },
];

const receivableEntries: Row[] = [
  { id: 'rv_1', side: 'RECEIVABLE', group: 'Official / Regular', dayKey: '2026-08-15', name: 'Imran Traders', amount: 350_000, settled: 200_000, accountSettled: 200_000, returnDayKey: '2026-10-15', purpose: 'Short-term loan' },
  { id: 'rv_2', side: 'RECEIVABLE', group: 'Official / Unofficial', dayKey: '2026-09-20', name: 'Zubair (site agent)', amount: 75_000, settled: 0, returnDayKey: '2026-10-30', purpose: 'Advance against commission' },
  { id: 'rv_3', side: 'RECEIVABLE', group: 'Committee', dayKey: '2026-10-01', name: 'Committee member — Shahid', amount: 50_000, settled: 0, purpose: 'October instalment' },
  { id: 'pv_1', side: 'PAYABLE', group: 'Official / Unofficial', dayKey: '2026-09-05', name: 'Al-Noor Printers', amount: 64_000, settled: 30_000, returnDayKey: '2026-10-20', purpose: 'Brochures and standees' },
  { id: 'pv_2', side: 'PAYABLE', group: 'Official / Unofficial', dayKey: '2026-10-02', name: 'Landlord — office', amount: 150_000, settled: 0, returnDayKey: '2026-10-10', purpose: 'October rent' },
];

const amanatEntries: Row[] = [
  { id: 'am_1', type: 'RECEIVED', party: 'Haji Rasheed', title: 'Plot payment on trust', amount: 300_000, paidAmount: 0, dayKey: '2026-09-15', depositAccountId: 'amanat_main', depositAccountName: 'Amanat' },
  { id: 'am_2', type: 'RECEIVED', party: 'Saima Bibi', title: 'Held until transfer', amount: 150_000, paidAmount: 0, dayKey: '2026-10-01', depositAccountId: 'amanat_main', depositAccountName: 'Amanat' },
  { id: 'am_3', type: 'EXPENSE', party: 'Haji Rasheed', title: 'Returned in part', amount: 50_000, paidAmount: 50_000, dayKey: '2026-10-08', purpose: 'Part return' },
];

const stateLifePolicies: Row[] = [
  { id: 'sl_1', dayKey: '2026-09-04', name: 'Tariq Mehmood', policyNumber: 'SL-482211', proposalNo: 'P-9031', srCode: 'SR-14', srName: 'Ayesha Khan', fyp: 240_000, pass: 220_000, discount: 0, slabReceipts: {} },
  { id: 'sl_2', dayKey: '2026-09-21', name: 'Rabia Anwar', policyNumber: 'SL-482390', proposalNo: 'P-9077', srCode: 'SR-14', srName: 'Ayesha Khan', fyp: 150_000, pass: 150_000, discount: 5_000, slabReceipts: {} },
  { id: 'sl_3', dayKey: '2026-10-05', name: 'Naveed Akhtar', policyNumber: 'SL-482512', proposalNo: 'P-9120', srCode: 'SR-21', srName: 'Bilal Ahmed', fyp: 400_000, pass: 380_000, discount: 0, slabReceipts: {} },
];

const marketingIncome: Row[] = [
  { id: 'mi_1', dayKey: '2026-09-18', customerName: 'Gulberg Heights', amountReceived: 180_000, soldByUid: 'demo-emp-1', soldByName: 'Ayesha Khan', soldByRole: 'employee', description: 'Campaign management — September' },
  { id: 'mi_2', dayKey: '2026-10-06', customerName: 'Lake City Developers', amountReceived: 95_000, soldByUid: 'demo-emp-2', soldByName: 'Bilal Ahmed', soldByRole: 'employee', description: '200-lead package' },
];

const carSales: Row[] = [
  { id: 'car_1', dayKey: '2026-09-27', carName: 'Toyota Corolla Altis 2021', purchaseDayKey: '2026-08-30', purchaseCost: 5_400_000, salePrice: 5_850_000, myPayment: 2_700_000,
    partners: [{ name: 'Me', percent: 50, basis: 'PERCENT', mine: true }, { name: 'Kamran Ali', percent: 50, basis: 'PERCENT' }],
    deductions: { investor: 0, ccCharges: 15_000, misc: 10_000 }, saleNote: 'Sold to a dealer in Johar Town' },
];

const capitalSpendings: Row[] = [
  { id: 'cs_1', investmentId: 'acc_partner_a', title: 'Plot token — Bahria Phase 8', amount: 750_000, paidAmount: 750_000, dayKey: '2026-09-05', description: 'Token for a 10-marla plot' },
];

const personalExpenses: Row[] = [
  { id: 'pe_1', employeeUid: 'demo-admin', title: 'Client lunch', category: 'Meals', vendor: 'Monal', amount: 14_500, paidAmount: 0, dayKey: '2026-10-07', purpose: 'Meeting with Gulberg Heights' },
  { id: 'pe_2', employeeUid: 'demo-admin', title: 'Site visit fuel', category: 'Travel', vendor: 'PSO', amount: 6_000, paidAmount: 6_000, dayKey: '2026-10-02', purpose: 'DHA Phase 6 visit' },
];

// October's sheet carries a figure typed over by hand and described, and one
// automatic figure described without being typed over — the two ways a
// description is used.
const groupMonths2026: Row[] = [
  {
    id: '2026-10',
    monthKey: '2026-10',
    status: 'OPEN',
    cellOverrides: { misc: 50_000 },
    cellNotes: {
      misc: 'Tour to Murree — team trip, 12–14 October',
      office: 'Includes the October rent and electricity',
    },
  },
];

const FIXTURE: Record<string, Row[]> = {
  'groupMonths:2026': groupMonths2026,
  accounts,
  transactions,
  investmentBooks,
  investmentRounds,
  receivableEntries,
  amanatEntries,
  'finance:stateLifePolicies': stateLifePolicies,
  'finance:marketingIncome': marketingIncome,
  'finance:carSales': carSales,
  'finance:capitalSpendings': capitalSpendings,
  'personalExpenses:all': personalExpenses,
};

/** The rows a `useLive` key reads in demo mode; an unknown key reads empty. */
export function demoLiveRows(key: string): Row[] {
  if (key in FIXTURE) return FIXTURE[key];
  if (key.startsWith('personalExpenses:')) {
    const uid = key.slice('personalExpenses:'.length);
    return personalExpenses.filter((row) => row.employeeUid === uid);
  }
  return [];
}
