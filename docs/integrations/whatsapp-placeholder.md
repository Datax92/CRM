# WhatsApp Integration — Placeholder / Seam

**Status:** credentials not yet provided by the client. Build the seam now, switched off, so
plugging in the real API later is a config change, not a rebuild.

## What exists today (Phase 1, per PRD BR-11)
Employees use `wa.me/{phone}` click-to-chat links to message customers manually, then log what was
sent as a normal `followUp` document (`whatsappNote` field). No outbound API call happens.

## The seam to build now
1. **Config doc:** `config/integrations` (Firestore) —
   ```json
   { "whatsapp": { "enabled": false, "phoneNumberId": null } }
   ```
2. **Server Action stub:** `src/app/actions/whatsapp.ts`
   (the design doc said `/functions/src/whatsapp.ts`; there is no Cloud Functions package —
   see `docs/implementation-notes.md`)
   ```ts
   export async function sendWhatsAppMessage(leadId: string, message: string) {
     const config = await getIntegrationsConfig();
     if (!config.whatsapp?.enabled) {
       return { skipped: true, reason: "whatsapp integration not yet configured" };
     }
     // TODO: real WhatsApp Business API call once credentials exist.
     // Reads WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID from the environment —
     // never hard-code them here.
   }
   ```
3. **Reserved environment variables** (set later, not now):
   - `WHATSAPP_API_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`

## Known gap in the seam
`sendWhatsAppMessage` currently has **no call sites**. The claim below that switching it on
needs "no new call sites" is not yet true — the places that should eventually send a message
still need to be identified and wired to it. Do that before the credentials arrive, not after.

## When the client provides credentials
1. Set `WHATSAPP_API_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` in Vercel Environment Variables.
2. Update `config/integrations.whatsapp` → `{ enabled: true, phoneNumberId: "<id>" }`
3. Fill in the real HTTP call in `sendWhatsAppMessage` (WhatsApp Cloud API `POST
   /{phone-number-id}/messages`, or whichever provider the client is using — confirm which before
   assuming Meta's own Cloud API vs. a BSP like Twilio/360dialog, since the request shape differs).
4. Wire up the call sites — see the known gap above. No schema change and no client-code changes
   are needed; every place that should send a message calls `sendWhatsAppMessage()` and gets a
   graceful no-op until the flag is flipped.

## Do not do
- Don't guess at API credentials or a specific provider's request format before they're provided.
- Don't build a second, parallel "future" WhatsApp module — extend this same function/seam.
