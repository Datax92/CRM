/**
 * Seeds the Firebase Emulator Suite with a working demo environment.
 *
 * Runs entirely against local emulators — no service account, no credentials,
 * and nothing touches the live project. The Admin SDK talks to emulators
 * unauthenticated when the *_EMULATOR_HOST variables are set, which is what
 * makes it possible to create accounts AND set role claims here.
 *
 *   npm run demo:seed     (emulators must already be running)
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'cms-system-crm';
const PASSWORD = 'Demo12345';

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000);
const hoursAgo = (n: number) => Timestamp.fromMillis(Date.now() - n * 3_600_000);
const daysAgo = (n: number) => Timestamp.fromMillis(Date.now() - n * 86_400_000);

async function upsertUser(
  email: string,
  name: string,
  role: 'admin' | 'employee',
  priority?: number
): Promise<string> {
  let uid: string;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    await auth.updateUser(uid, { password: PASSWORD, displayName: name });
  } catch {
    const created = await auth.createUser({ email, password: PASSWORD, displayName: name });
    uid = created.uid;
  }

  await auth.setCustomUserClaims(uid, { role });
  await db.collection('users').doc(uid).set({
    name,
    email,
    role,
    status: 'ACTIVE',
    ...(priority ? { priority } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });

  return uid;
}

async function main() {
  console.log(`\nSeeding demo data into the emulators (project ${PROJECT_ID})\n`);

  const admin = await upsertUser('admin@crm.com', 'Usman Sheikh', 'admin');
  const ayesha = await upsertUser('ayesha@crm.com', 'Ayesha Khan', 'employee', 1);
  const bilal = await upsertUser('bilal@crm.com', 'Bilal Ahmed', 'employee', 2);
  const sana = await upsertUser('sana@crm.com', 'Sana Malik', 'employee', 3);
  console.log('  4 accounts, each with a role claim');

  const campaigns = [
    { id: '23851', name: 'DHA Phase 6 — Plot Enquiry' },
    { id: '23852', name: 'Bahria Town — Apartments' },
    { id: '23853', name: 'Gulberg — Commercial Floors' },
  ];
  for (const campaign of campaigns) {
    await db.collection('campaigns').doc(campaign.id).set({
      name: campaign.name,
      metaCampaignId: campaign.id,
    });
  }

  interface SeedLead {
    id: string;
    name: string;
    phone: string;
    email: string;
    city: string;
    status: string;
    campaign: number;
    assigned: string | null;
    createdAt: Timestamp;
    assignedAt?: Timestamp;
    acceptedAt?: Timestamp;
    closedAt?: Timestamp;
    adminAssignDeadlineAt?: Date;
    acceptDeadlineAt?: Date;
    followUpCount?: number;
    callCount?: number;
  }

  const leads: SeedLead[] = [
    { id: 'lead_1001', name: 'Hamza Tariq', phone: '923001234567', email: 'hamza.tariq@gmail.com', city: 'Lahore',
      status: 'NEW', campaign: 0, assigned: null, createdAt: hoursAgo(0.05), adminAssignDeadlineAt: minutesFromNow(3.5) },
    { id: 'lead_1002', name: 'Fatima Noor', phone: '923215558899', email: 'f.noor@outlook.com', city: 'Karachi',
      status: 'NEW', campaign: 1, assigned: null, createdAt: hoursAgo(0.02), adminAssignDeadlineAt: minutesFromNow(4.6) },
    { id: 'lead_1003', name: 'Imran Qureshi', phone: '923334447788', email: 'imran.q@gmail.com', city: 'Islamabad',
      status: 'ASSIGNED', campaign: 0, assigned: ayesha, createdAt: hoursAgo(0.3), assignedAt: hoursAgo(0.05),
      acceptDeadlineAt: minutesFromNow(7.2) },
    { id: 'lead_1004', name: 'Zainab Rashid', phone: '923018887766', email: 'zainab.r@gmail.com', city: 'Lahore',
      status: 'NEGOTIATION', campaign: 2, assigned: ayesha, createdAt: daysAgo(3), assignedAt: daysAgo(3),
      acceptedAt: daysAgo(3), followUpCount: 3, callCount: 5 },
    { id: 'lead_1005', name: 'Ahmed Raza', phone: '923457778899', email: 'ahmed.raza@company.pk', city: 'Karachi',
      status: 'INTERESTED', campaign: 1, assigned: bilal, createdAt: daysAgo(2), assignedAt: daysAgo(2),
      acceptedAt: daysAgo(2), followUpCount: 2, callCount: 2 },
    { id: 'lead_1006', name: 'Sadia Iqbal', phone: '923219994455', email: 'sadia.iqbal@gmail.com', city: 'Multan',
      status: 'CONTACTED', campaign: 0, assigned: sana, createdAt: daysAgo(1), assignedAt: daysAgo(1),
      acceptedAt: daysAgo(1), followUpCount: 1, callCount: 1 },
    { id: 'lead_1007', name: 'Kamran Butt', phone: '923006665544', email: 'k.butt@gmail.com', city: 'Lahore',
      status: 'NO_RESPONSE', campaign: 1, assigned: bilal, createdAt: daysAgo(4), assignedAt: daysAgo(4),
      acceptedAt: daysAgo(4), followUpCount: 4, callCount: 6 },
    { id: 'lead_1008', name: 'Nida Aslam', phone: '923331112233', email: 'nida.aslam@gmail.com', city: 'Faisalabad',
      status: 'CLOSED_WON', campaign: 2, assigned: ayesha, createdAt: daysAgo(9), assignedAt: daysAgo(9),
      acceptedAt: daysAgo(9), closedAt: daysAgo(2), followUpCount: 5, callCount: 8 },
    { id: 'lead_1009', name: 'Yasir Mehmood', phone: '923005554433', email: 'yasir.m@gmail.com', city: 'Rawalpindi',
      status: 'CLOSED_WON', campaign: 0, assigned: bilal, createdAt: daysAgo(14), assignedAt: daysAgo(14),
      acceptedAt: daysAgo(14), closedAt: daysAgo(6), followUpCount: 3, callCount: 4 },
    { id: 'lead_1010', name: 'Hina Javed', phone: '923452223344', email: 'hina.javed@gmail.com', city: 'Lahore',
      status: 'CLOSED_LOST', campaign: 1, assigned: sana, createdAt: daysAgo(11), assignedAt: daysAgo(11),
      acceptedAt: daysAgo(11), followUpCount: 2, callCount: 3 },
  ];

  for (const lead of leads) {
    const campaign = campaigns[lead.campaign];

    await db.collection('leads').doc(lead.id).set({
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      city: lead.city,
      source: 'META_ADS',
      status: lead.status,
      assignedUserId: lead.assigned,
      attemptedAssignees: lead.assigned ? [lead.assigned] : [],
      campaignId: campaign.id,
      campaignName: campaign.name,
      adId: `ad_${campaign.id}`,
      formId: `form_${campaign.id}`,
      createdAt: lead.createdAt,
      followUpCount: lead.followUpCount ?? 0,
      callCount: lead.callCount ?? 0,
      ...(lead.assignedAt ? { assignedAt: lead.assignedAt, lastActivityAt: lead.assignedAt } : {}),
      ...(lead.acceptedAt ? { acceptedAt: lead.acceptedAt } : {}),
      ...(lead.closedAt ? { closedAt: lead.closedAt } : {}),
      ...(lead.adminAssignDeadlineAt ? { adminAssignDeadlineAt: lead.adminAssignDeadlineAt } : {}),
      ...(lead.acceptDeadlineAt ? { acceptDeadlineAt: lead.acceptDeadlineAt } : {}),
      ...(lead.assigned ? { distributionMethod: 'AUTO' } : {}),
    });

    await db.collection('leads').doc(lead.id).collection('events').add({
      type: 'LEAD_INGESTED',
      actorUid: 'system:meta-webhook',
      at: lead.createdAt,
      meta: { campaignName: campaign.name, contactDetailsRetrieved: true },
    });

    if (lead.assigned && lead.assignedAt) {
      await db.collection('leads').doc(lead.id).collection('events').add({
        type: 'AUTO_ASSIGNED',
        actorUid: 'system:cron',
        at: lead.assignedAt,
        meta: { assignedTo: lead.assigned },
      });
    }
  }
  console.log(`  ${leads.length} leads across 3 campaigns`);

  const followUps: Record<string, { message: string; call: boolean; calls: number; wa: string; ago: number }[]> = {
    lead_1004: [
      { message: 'Client visited the Gulberg site. Wants a corner floor, asked for a payment plan over 18 months.', call: true, calls: 2, wa: 'Sent floor plan PDF', ago: 6 },
      { message: 'Sent the revised quote. He is comparing against one other option and will confirm this week.', call: true, calls: 2, wa: 'Shared revised quote', ago: 30 },
      { message: 'First contact. Confirmed his budget range and that this is for office use, not investment.', call: true, calls: 1, wa: '', ago: 70 },
    ],
    lead_1005: [
      { message: 'Wants a 3-bed on a higher floor. Asked about possession timeline and maintenance charges.', call: true, calls: 1, wa: 'Sent brochure', ago: 20 },
      { message: 'Initial call. Interested, but travelling until next week.', call: true, calls: 1, wa: '', ago: 44 },
    ],
    lead_1008: [
      { message: 'Deal agreed. Paperwork signed at the office, payment received by bank transfer.', call: true, calls: 1, wa: 'Confirmed transfer', ago: 50 },
      { message: 'Final negotiation on price. Agreed after a small discount.', call: true, calls: 3, wa: '', ago: 96 },
    ],
  };

  let followUpTotal = 0;
  for (const [leadId, entries] of Object.entries(followUps)) {
    const lead = leads.find((l) => l.id === leadId)!;
    for (const entry of entries) {
      await db.collection('leads').doc(leadId).collection('followUps').add({
        message: entry.message,
        callMade: entry.call,
        callCount: entry.calls,
        whatsappNote: entry.wa || null,
        occurredAt: hoursAgo(entry.ago),
        createdAt: hoursAgo(entry.ago),
        authorUid: lead.assigned,
        authorEmail: lead.assigned === ayesha ? 'ayesha@crm.com' : 'bilal@crm.com',
      });
      followUpTotal++;
    }
  }
  console.log(`  ${followUpTotal} follow-ups`);

  const deals = [
    {
      leadId: 'lead_1008', userId: ayesha, campaign: 2, ago: 2,
      customer: { name: 'Nida Aslam', phone: '923331112233', email: 'nida.aslam@gmail.com', cnic: '33100-1234567-8', address: 'House 42, Block C, Peoples Colony', city: 'Faisalabad' },
      service: 'Gulberg commercial floor — 2nd floor, 1,850 sq ft',
      received: 4850000, payable: 3200000, method: 'Bank Transfer',
    },
    {
      leadId: 'lead_1009', userId: bilal, campaign: 0, ago: 6,
      customer: { name: 'Yasir Mehmood', phone: '923005554433', email: 'yasir.m@gmail.com', cnic: '37405-7654321-1', address: 'Flat 7B, Askari 14', city: 'Rawalpindi' },
      service: 'DHA Phase 6 — 10 marla residential plot',
      received: 2750000, payable: 1900000, method: 'Cheque',
    },
  ];

  for (const deal of deals) {
    const campaign = campaigns[deal.campaign];
    await db.collection('closedDeals').doc(deal.leadId).set({
      leadId: deal.leadId,
      userId: deal.userId,
      enteredByUid: deal.userId,
      customer: deal.customer,
      serviceDescription: deal.service,
      paymentMethod: deal.method,
      notes: null,
      amountReceived: deal.received,
      payableAmount: deal.payable,
      profit: deal.received - deal.payable,
      campaignId: campaign.id,
      campaignName: campaign.name,
      source: 'META_ADS',
      dealDate: daysAgo(deal.ago),
      enteredAt: daysAgo(deal.ago),
    });
  }
  console.log(`  ${deals.length} closed deals with full customer records`);

  const expenses = [
    { title: 'Office rent — August', category: 'Rent', amount: 250000, ago: 12 },
    { title: 'Team salaries — August', category: 'Salaries', amount: 920000, ago: 12 },
    { title: 'Meta Ads — lead campaigns', category: 'Marketing', amount: 175000, ago: 8 },
    { title: 'Fibre internet', category: 'Internet', amount: 12000, ago: 10 },
    { title: 'Electricity bill', category: 'Electricity', amount: 46500, ago: 5 },
    { title: 'CRM and software licences', category: 'Software', amount: 28000, ago: 3 },
  ];
  for (const expense of expenses) {
    await db.collection('expenses').add({
      title: expense.title,
      category: expense.category,
      amount: expense.amount,
      description: null,
      date: daysAgo(expense.ago),
      addedByUid: admin,
      addedByEmail: 'admin@crm.com',
      createdAt: daysAgo(expense.ago),
    });
  }
  console.log(`  ${expenses.length} expenses`);

  await db.collection('notifications').doc('demo_redflag').set({
    type: 'RED_FLAG', leadId: 'lead_1007', targetRole: 'admin',
    payload: { message: 'Kamran Butt was not accepted within 10 minutes.' },
    createdAt: hoursAgo(2), readAt: null,
  });
  await db.collection('notifications').doc('nofollowup_lead_1007').set({
    type: 'NO_FOLLOWUP', leadId: 'lead_1007', targetRole: 'admin',
    payload: { message: 'No follow-up logged on Kamran Butt for over 24 hours.' },
    createdAt: hoursAgo(1), readAt: null,
  });

  await db.collection('config').doc('integrations').set({
    whatsapp: { enabled: false, phoneNumberId: null },
  });
  await db.collection('config').doc('distribution').set({
    cycleState: { [ayesha]: 3, [bilal]: 2, [sana]: 1 },
  });
  console.log('  2 alerts and config seeded');

  console.log(`\n  Sign in at http://localhost:3000 — password for all accounts: ${PASSWORD}\n`);
  console.log('    admin@crm.com     Usman Sheikh    Admin');
  console.log('    ayesha@crm.com    Ayesha Khan     Employee, priority 1');
  console.log('    bilal@crm.com     Bilal Ahmed     Employee, priority 2');
  console.log('    sana@crm.com      Sana Malik      Employee, priority 3\n');
}

main().catch((error) => {
  console.error('\nSeeding failed:', error);
  process.exit(1);
});
