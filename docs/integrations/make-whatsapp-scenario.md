# Make.com scenario — Click-to-WhatsApp ad → CRM lead

**What it does.** Someone taps a Click-to-WhatsApp ad on Facebook or Instagram, WhatsApp
opens on their phone, they send a message. That message becomes a lead in the CRM: filed
in the Data Bank grouped by the campaign of the ad they tapped, and offered down the priority lane with
the five-minute accept window, exactly as a Meta form lead is.

**The CRM end is built and needs nothing.** `POST /api/webhooks/whatsapp-bridge`
(`src/app/api/webhooks/whatsapp-bridge/route.ts`). This document is the Make half.

---

## Prerequisite — how is the client's WhatsApp set up?

This decides whether the scenario is possible at all, so settle it first.

| Their setup | Can Make see the messages? |
|---|---|
| **WhatsApp Business Cloud API** (number registered to a Meta app) | **Yes.** Use Make's *WhatsApp Business Cloud → Watch Events* trigger. |
| **A BSP inbox** (360dialog, Twilio, Wati, Respond.io…) | **Yes**, via that provider's own Make app or its webhook. They all sit on the Cloud API underneath. |
| **The free WhatsApp Business app on a phone** | **No.** There is no webhook and no API. Nothing in Make can read those messages — the number has to move onto the Cloud API or a BSP first. |

The third row is the common surprise, and there is no way round it. A number on the plain
WhatsApp Business app is a phone app; it has no server side to call out from.

**If they move to the Cloud API, check Coexistence.** Historically, registering a number
on the Cloud API meant it could no longer be used in the WhatsApp Business phone app — a
problem when the sales team replies by hand. Meta's Coexistence feature is meant to allow
both; confirm it covers this number before migrating, because the migration is not
casually reversible.

---

## The scenario — three modules

### 1 · Trigger — WhatsApp Business Cloud → Watch Events

Subscribe to **messages**. Connect it to the client's WhatsApp Business account.

### 2 · Filter — inbound messages only

The same webhook carries delivery receipts and read receipts. Let through only bundles
that actually contain a message:

    messages[] — Exists

Do not filter on `referral` in Make — **the bridge does it**. Only messages carrying an ad
referral become leads (owner's instruction, 2026-09-17): this is the business's everyday
number, and a supplier's invoice must not be offered to a salesperson. Everything else comes
back `200 {"outcome":"NOT_FROM_AD"}`, which is what Make's history shows when somebody asks
why a message did not appear.

### 3 · HTTP → Make a request

| Field | Value |
|---|---|
| URL | `https://crm-seven-pi-55.vercel.app/api/webhooks/whatsapp-bridge` |
| Method | `POST` |
| Header | `Authorization: Bearer <META_BRIDGE_SECRET>` |
| Body type | Raw / JSON (`application/json`) |

Body — note that **Make indexes arrays from 1**, not 0:

```json
{
  "phone":        "{{1.contacts[1].wa_id}}",
  "name":         "{{1.contacts[1].profile.name}}",
  "message_id":   "{{1.messages[1].id}}",
  "message":      "{{1.messages[1].text.body}}",
  "timestamp":    "{{1.messages[1].timestamp}}",
  "ad_id":        "{{1.messages[1].referral.source_id}}",
  "ad_headline":  "{{1.messages[1].referral.headline}}",
  "ad_body":      "{{1.messages[1].referral.body}}",
  "source_url":   "{{1.messages[1].referral.source_url}}",
  "ctwa_clid":    "{{1.messages[1].referral.ctwa_clid}}"
}
```

Every field except `phone` may be empty — the bridge reads what is there. `phone` is the
only hard requirement, because a contact nobody can ring is not a lead.

**Map from a real run, don't type the paths.** Press *Run once*, send a WhatsApp message
to the business number, then build this body by clicking fields in the mapping panel. If
the names above don't match what module 1 actually outputs, `phone` arrives empty and the
bridge files nothing. It answers `200`, so Make still shows a green tick.

**Then turn the scenario on.** Save, and switch on *Immediately as data arrives*. Until
you do, the scenario only runs while you press *Run once*.

**Turn off "Parse response" errors.** The bridge answers `200` for cases that are final
answers rather than failures (a duplicate, a message with no number), so a non-2xx would
make Make retry something that can never succeed.

---

## Do not build dedupe in Make

A conversation is a stream. Send **every** inbound message; the CRM decides.

The first-contact rule lives in the bridge and asks the *pipeline*, not the payload —
only the database knows who is already a customer. A second message from a number
already held comes back as:

```json
{ "ok": true, "outcome": "ALREADY_A_LEAD", "leadId": "…",
  "message": "That number is already in the pipeline — no second lead created." }
```

That check is deliberately **wider than the form bridge's**. A form's duplicate rule is
per folder, because two campaigns legitimately reach the same person. Here the same
person is messaging you, and a second conversation is the same human being whichever ad
they tapped.

**The cost, stated:** every message spends one Make operation, including the ones that
come back `ALREADY_A_LEAD`. At ~5 messages a conversation, 100 conversations is ~500
operations a month against the free tier's 1,000. Filtering on `referral` in Make would cut
that, but a Make filter fails silently if the field is ever mapped wrong, where the bridge's
`NOT_FROM_AD` is visible in the history. Watch the number; if it becomes a problem, a paid Make tier
is cheaper than the leads.

---

## Testing it

1. **Confirm the endpoint is live and configured** — a `GET` needs no secret:

       curl https://crm-seven-pi-55.vercel.app/api/webhooks/whatsapp-bridge

   `{"ok":true,"endpoint":"whatsapp-bridge","configured":true}`. If `configured` is
   `false`, `META_BRIDGE_SECRET` is not set on Vercel and **every delivery is refused** —
   the endpoint fails closed by design.

2. **Send one by hand**, with a number not already in the pipeline:

       curl -X POST https://crm-seven-pi-55.vercel.app/api/webhooks/whatsapp-bridge \
         -H "Authorization: Bearer $META_BRIDGE_SECRET" \
         -H "Content-Type: application/json" \
         -d '{"phone":"923001234567","name":"Test Person",
              "message":"Salam, price?","ad_headline":"Facile Town 2"}'

   Include `"ad_id":"120212345"` — without an ad the bridge answers `NOT_FROM_AD`.
   Expect `{"ok":true,"outcome":"CREATED", …, "offer":{"outcome":"OFFERED","assigneeName":"…"}}`
   — `CREATED` is the Data Bank filing, `offer` is the lane. `offer.outcome: "NO_LANE"`
   means it was filed but nobody is in the lane to receive it.

   **This notifies a real employee** and starts a real five-minute clock. Use a number
   you are willing to see in the pipeline, and delete the lead afterwards.

3. **Send the same number again** — expect `ALREADY_A_LEAD` and no second lead.

4. **Tap the real ad from a phone** whose number is not in the pipeline. That is the only
   test that proves the referral block arrives, because Meta attaches it and nothing else
   can fake it convincingly.

---

## What arrives, and what does not

A click-to-WhatsApp lead is **richer in intent and thinner in fields** than a form lead:
their number, their WhatsApp profile name (often a nickname, sometimes an emoji), the
words they typed, and the ad they tapped. **No email, no city, no budget** unless they
happen to type it.

Their first message and the ad headline are stored as **notes, not typed fields** — "around
50 lakh maybe" is a sentence, and storing it as a number would invent a precision the
customer never gave.

Leads are grouped **by campaign**. The referral carries only the ad id, so the bridge asks
Meta for the ad's campaign (`resolveCampaign`) and files the lead under it — the same
`meta_campaign_{id}` folder a lead-form ad in that campaign fills. The response says
`groupedBy: "CAMPAIGN"`.

**That lookup needs `META_ADS_ACCESS_TOKEN`** — a system-user token with `ads_read` whose
system user can see the ad account. A Page token cannot read an ad. Without it, or if Meta
does not answer within 8s, the lead is still filed, one folder per ad named from its headline,
and the response says `groupedBy: "AD"`.

---

## Related

- `docs/integrations/whatsapp-placeholder.md` — the *outbound* send seam, still switched off.
- `src/lib/whatsappIntake.ts` — every field spelling the bridge accepts.
- `/api/webhooks/meta-bridge` — the same pattern for Meta **lead form** ads, same secret.
