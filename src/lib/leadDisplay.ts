/**
 * Small presentation helpers shared by the leads workspace.
 *
 * Kept out of the components so the list row and the detail header can't drift
 * apart — the avatar in both places has to read the same for the same lead.
 */

/**
 * Two-letter avatar initials.
 *
 * "ABDULLAH AHSAN" -> "AA", "newLead" -> "NE". Falls back to "?" rather than
 * throwing on the empty or whitespace-only names that Meta intake can produce.
 */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const raw = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];
  return raw.toUpperCase();
}

/**
 * Avatar ring colour, carrying the lead's stage at a glance in the list.
 *
 * Amber = waiting on a person (assigned, not yet accepted), blue = in flight,
 * teal = won, grey = closed out. The status is always also printed as text on
 * the row, so this never carries meaning on its own.
 */
export function avatarRingColor(status: string): string {
  switch (status) {
    case "NEW":
    case "UNASSIGNED_NO_CAPACITY":
      return "#e05a4a";
    case "ASSIGNED":
      return "#e0b44f";
    case "CLOSED_WON":
      return "#4f9c99";
    case "CLOSED_LOST":
    case "NOT_INTERESTED":
      return "#c3d0ce";
    default:
      return "#7fb8d6";
  }
}
