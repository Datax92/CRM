"use server";

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { DEFAULT_NO_CONTACT_DAYS, MAX_NO_CONTACT_DAYS } from "@/lib/constants/monitoring";

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
  /** Days without contact before the lead's owner is reminded. */
  noContactDays: number;
}

/**
 * Reads the reminder window. Read-only, admin-gated view of the same
 * `config/monitoring` document the cron consults, so Settings shows the live
 * value without restating the cron's fallback.
 *
 * The retired `noFollowUpHours` is deliberately **not** read: it was a
 * different question in a different unit (hours before the *admin* was told),
 * and quietly reinterpreting 24 as 24 days would have silenced the reminder
 * for the better part of a month.
 */
export async function getMonitoringConfig(token: string): Promise<ActionResult<MonitoringConfig>> {
  return runAction("getMonitoringConfig", async () => {
    await requireAdmin(token);
    const snap = await adminDb.collection("config").doc("monitoring").get();
    const value = Number(snap.data()?.noContactDays);
    return {
      noContactDays: Number.isFinite(value) && value > 0 ? value : DEFAULT_NO_CONTACT_DAYS,
    };
  });
}

/**
 * Sets the reminder window. Admin-only: only the admin configures distribution
 * and monitoring behaviour. Written with the Admin SDK, which bypasses
 * firestore.rules the same way every other write action here does.
 */
export async function setNoContactDays(token: string, days: number): Promise<ActionResult> {
  return runAction("setNoContactDays", async () => {
    await requireAdmin(token);

    const value = Number(days);
    if (!Number.isFinite(value) || value < 1 || value > MAX_NO_CONTACT_DAYS) {
      throw new UserFacingError(`Enter a reminder window between 1 and ${MAX_NO_CONTACT_DAYS} days.`);
    }

    await adminDb.collection("config").doc("monitoring").set(
      { noContactDays: Math.round(value) },
      { merge: true }
    );
  });
}
