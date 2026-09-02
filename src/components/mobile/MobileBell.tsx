"use client";

/**
 * The header bell from `Day End Dashboard Mobile.dc.html` — a 38px translucent
 * disc with a white glyph and an amber dot ringed in the header's own teal so
 * the ring reads as a cut-out rather than a stroke.
 *
 * Built rather than reused: `NotificationsPanel` is styled for a white desktop
 * top bar, so dropping it on the teal header rendered a black bell and a red
 * badge that belonged to a different design. It reads the same `useNotifications`
 * hook, so the count and the list are the same data — only the presentation is
 * the phone's.
 *
 * The list opens as a sheet rather than a popover: a dropdown anchored to a
 * 38px target is a desktop pattern, and on a phone it would sit off the edge.
 */

import { useState } from "react";
import { useNotifications } from "@/hooks/useFinancials";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/clientActions";
import { formatBusinessDateTime } from "@/lib/dates";
import { M } from "./mobileChrome";
import { Sheet } from "./MobileLeadDetail";

const TYPE_LABELS: Record<string, string> = {
  RED_FLAG: "Not accepted in time",
  NO_FOLLOWUP: "No follow-up logged",
  UNASSIGNED_LEAD: "Needs manual assignment",
  NEW_LEAD_ASSIGNED: "New lead assigned",
};

export function MobileBell({
  uid,
  role,
  getIdToken,
}: {
  uid: string | undefined;
  role: string | undefined;
  getIdToken: () => Promise<string>;
}) {
  const { notifications } = useNotifications(uid, role);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const count = notifications.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        className="mob-press"
        style={{
          position: "relative",
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: M.circleBg,
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
          <path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 15ZM10 20a2 2 0 0 0 4 0" />
        </svg>
        {count > 0 && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 6,
              right: 8,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#ffcf6b",
              // The ring is the header's own teal, so the dot reads as punched
              // out of the disc rather than outlined.
              border: `1.5px solid ${M.teal}`,
            }}
          />
        )}
      </button>

      {open && (
        <Sheet
          title="Alerts"
          subtitle={count > 0 ? `${count} unread` : "Nothing needs you right now."}
          onClose={() => setOpen(false)}
        >
          {count === 0 ? (
            <div
              style={{
                padding: "34px 12px",
                textAlign: "center",
                fontSize: 13.5,
                fontWeight: 500,
                color: M.faint,
                lineHeight: 1.5,
              }}
            >
              You are all caught up.
            </div>
          ) : (
            <>
              {notifications.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className="mob-press"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await markNotificationRead(await getIdToken(), note.id);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  style={{
                    textAlign: "left",
                    border: `1px solid ${M.cardBorder}`,
                    background: "#f7fbfa",
                    borderRadius: M.rowRadius,
                    padding: "13px 14px",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", color: M.tealDeep }}>
                    {TYPE_LABELS[note.type] ?? note.type.replace(/_/g, " ")}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: M.body, marginTop: 5, lineHeight: 1.45 }}>
                    {note.payload?.message ?? "—"}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: M.ghost,
                      marginTop: 5,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatBusinessDateTime(note.createdAt)}
                  </div>
                </button>
              ))}
              <button
                type="button"
                className="mob-press"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await markAllNotificationsRead(await getIdToken());
                    setOpen(false);
                  } finally {
                    setBusy(false);
                  }
                }}
                style={{
                  marginTop: 4,
                  width: "100%",
                  padding: 14,
                  borderRadius: 999,
                  border: `1px solid ${M.cardBorder}`,
                  background: "#f7fbfa",
                  color: M.muted,
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  opacity: busy ? 0.5 : 1,
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {busy ? "Working…" : "Mark all as read"}
              </button>
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
