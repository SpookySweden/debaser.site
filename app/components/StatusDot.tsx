'use client';

import {
  presenceDotColour,
  presenceLabel,
  presenceTooltip,
  type PresenceRecord,
  type PresenceStatus,
} from '../lib/profile/presence';

/** Edge length of the lamp beside a username. */
export const STATUS_DOT_SIZE = 8;

type StatusDotProps = {
  status: PresenceStatus;
  /** The record behind the colour, so the tooltip can add "last seen". */
  record?: PresenceRecord;
  /** Rendered square size in pixels. */
  size?: number;
  className?: string;
};

/**
 * The lamp that sits beside a username.
 *
 * Green is "online now", yellow is "was here within the hour", red is anything
 * older. It is a square lamp rather than a circle for the usual reason - nothing
 * on this site rounds a corner - and its three colours are swatches from
 * `name-colours.ts` (green / yellow / red), so it belongs to the same palette the
 * usernames use. Swap it for a hand-drawn sprite by pointing the span's style at
 * an `assets/` image instead: nothing else knows how the dot is painted.
 */
export default function StatusDot({ status, record, size = STATUS_DOT_SIZE, className }: StatusDotProps) {
  const label = presenceLabel(status);

  return (
    <span
      role="img"
      aria-label={label}
      title={presenceTooltip(status, record)}
      className={`inline-block shrink-0 rounded-none border border-black align-middle ${className ?? ''}`}
      style={{ width: size, height: size, backgroundColor: presenceDotColour(status) }}
    />
  );
}
