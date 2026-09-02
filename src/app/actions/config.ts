"use server";

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { DEFAULT_NO_FOLLOWUP_HOURS } from "@/lib/constants/monitoring";

export interface IntegrationsConfig {
  whatsapp: {
    enabled: boolean;
    phoneNumberId: string | null;
  };
}

const DEFAULT_CONFIG: IntegrationsConfig = {
  whatsapp: { enabled: false, phoneNumberId: null },
};

/**
 * Feature flags for outbound integrations (architecture.md §10).
 *
 * Defaults to everything off, so a missing config document behaves the same as
 * an explicitly disabled one rather than throwing.
 */
export async function getIntegrationsConfig(): Promise<IntegrationsConfig> {
  try {
    const snap = await adminDb.collection("config").doc("integrations").get();
    if (!snap.exists) return DEFAULT_CONFIG;

    const data = snap.data() ?? {};
    return {
      whatsapp: {
        enabled: Boolean(data.whatsapp?.enabled),
        phoneNumberId: data.whatsapp?.phoneNumberId ?? null,
      },
    };
  } catch (error) {
    console.error("[config] Could not read config/integrations:", error);
    return DEFAULT_CONFIG;
  }
}

export interface MonitoringConfig {
  noFollowUpHours: number;
}

/**
 * Reads the FR-18 monitoring window (hours with no follow-up before a lead is
 * flagged). Read-only, admin-gated view of the same config/monitoring doc the
 * cron job consults — lets Settings show the live value without duplicating
 * the cron's fallback logic.
 */
export async function getMonitoringConfig(token: string): Promise<ActionResult<MonitoringConfig>> {
  return runAction("getMonitoringConfig", async () => {
    await requireAdmin(token);
    const snap = await adminDb.collection("config").doc("monitoring").get();
    const value = Number(snap.data()?.noFollowUpHours);
    return {
      noFollowUpHours: Number.isFinite(value) && value > 0 ? value : DEFAULT_NO_FOLLOWUP_HOURS,
    };
  });
}

/**
 * Sets the FR-18 monitoring window. Admin-only (BR: only Admin configures
 * distribution/monitoring behavior). Writes via the Admin SDK, so this bypasses
 * firestore.rules the same way every other write action here does.
 */
export async function setNoFollowUpHours(token: string, hours: number): Promise<ActionResult> {
  return runAction("setNoFollowUpHours", async () => {
    await requireAdmin(token);

    const value = Number(hours);
    if (!Number.isFinite(value) || value <= 0 || value > 720) {
      throw new UserFacingError("Enter a follow-up window between 1 and 720 hours.");
    }

    await adminDb.collection("config").doc("monitoring").set(
      { noFollowUpHours: Math.round(value) },
      { merge: true }
    );
  });
}
