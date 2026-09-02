"use server";
import { getIntegrationsConfig } from "./config";

export async function sendWhatsAppMessage(leadId: string, message: string) {
  const config = await getIntegrationsConfig();
  
  if (!config.whatsapp?.enabled) {
    console.log(`[WhatsApp Seam] Skipped sending to lead ${leadId}. Integration not enabled.`);
    return { skipped: true, reason: "whatsapp integration not yet configured" };
  }
  
  // TODO: Real WhatsApp API call once credentials exist
  // We'll read process.env.WHATSAPP_API_TOKEN etc. when ready.
  console.log(`[WhatsApp Seam] Would send message to ${leadId}: ${message}`);
  
  return { success: true };
}
