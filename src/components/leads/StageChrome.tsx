"use client";

/**
 * Shared Pipeline Stage presentation — Cold / P3 / P2 / P1.
 *
 * The list row, the filter chips, the detail pane's stage control and the phone
 * screens all read from one palette here, so a lead cannot be one shade of
 * amber in the list and a different amber in the pane.
 *
 * **The ramp is a progression, not four unrelated colours.** Cold is the slate
 * blue that reads as "parked"; P3, P2 and P1 warm through amber into the app's
 * own teal, so a row visibly improves as the lead climbs. Teal is reserved for
 * P1 deliberately — it is the accent the rest of the product uses for "this is
 * good", and spending it on a middling stage would make it meaningless.
 *
 * Colours are inline rather than Tailwind arbitrary values on purpose: this
 * project has twice shipped a build whose content scanner never saw a `bg-[#…]`
 * string, and the element then renders with no background at all. An inline
 * style cannot be missed by a scanner.
 */

import { Snowflake, CircleDashed, Flame, Trophy } from "lucide-react";
import {
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGE_NAMES,
  type PipelineStage,
} from "@/lib/pipelineStage";

export interface StageTone {
  /** Quiet pill, for a list row that must not shout. */
  soft: string;
  softText: string;
  softBorder: string;
  /** The same colour asserted, for an active chip or a pressed button. */
  solid: string;
  onSolid: string;
}

export const STAGE_TONES: Record<PipelineStage, StageTone> = {
  COLD: {
    soft: "#eaf1f6",
    softText: "#4d7590",
    softBorder: "#cfe0eb",
    solid: "#4d7590",
    onSolid: "#ffffff",
  },
  P3: {
    soft: "#fdf1e3",
    softText: "#a4682a",
    softBorder: "#f2ddc2",
    solid: "#c2853a",
    onSolid: "#ffffff",
  },
  P2: {
    soft: "#fdece7",
    softText: "#b8492f",
    softBorder: "#f5cec3",
    solid: "#c0563c",
    onSolid: "#ffffff",
  },
  P1: {
    soft: "#e2f0ee",
    softText: "#2f7d78",
    softBorder: "#cfe2e0",
    solid: "#2f7d78",
    onSolid: "#ffffff",
  },
};

const STAGE_ICONS: Record<PipelineStage, typeof Flame> = {
  COLD: Snowflake,
  P3: CircleDashed,
  P2: Flame,
  P1: Trophy,
};

export function StageIcon({ stage, size = 12 }: { stage: PipelineStage; size?: number }) {
  const Icon = STAGE_ICONS[stage];
  return <Icon size={size} strokeWidth={2} className="shrink-0" aria-hidden />;
}

/**
 * The row and header badge.
 *
 * The label is always present beside the icon — colour and glyph alone would
 * leave the stage unreadable to anyone who cannot separate the two warm hues,
 * and "P2" against "P3" is exactly the pair that has to stay distinguishable.
 */
export function StagePill({
  stage,
  manual,
  size = "sm",
}: {
  stage: PipelineStage;
  manual?: boolean;
  size?: "sm" | "md";
}) {
  const tone = STAGE_TONES[stage];
  const medium = size === "md";

  return (
    <span
      title={`${PIPELINE_STAGE_NAMES[stage]}${manual ? " · set by hand" : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: medium ? "3px 9px" : "2px 7px",
        borderRadius: 999,
        border: `1px solid ${tone.softBorder}`,
        background: tone.soft,
        color: tone.softText,
        fontSize: medium ? 12 : 11,
        fontWeight: 600,
        letterSpacing: "0.1px",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      <StageIcon stage={stage} size={medium ? 12 : 11} />
      {PIPELINE_STAGE_LABELS[stage]}
      {/* A dot, not the word "manual" — the tooltip carries the detail and the
          row has no room for a second word. */}
      {manual && <span aria-hidden>·</span>}
    </span>
  );
}
