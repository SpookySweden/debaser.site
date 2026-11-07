'use client';

import {
  presenceDotColour,
  presenceLabel,
  presenceLine,
  type PresenceRecord,
  type PresenceStatus,
} from '../lib/profile/presence';

/** Edge length of the lamp beside a username. */
export const STATUS_DOT_SIZE = 8;

/** What a private lamp is called, aloud and under the pointer. It says the same whether they are online or not. */
export const PRIVATE_LAMP_LABEL = 'ONLINE LAMP PRIVATE';

type StatusDotProps = {
  /** `private`: this person keeps their lamp to themselves, so the box says nothing about whether they are here. */
  status: PresenceStatus | 'private';
  /** The record behind the colour, so the tooltip can add "last seen". */
  record?: PresenceRecord;
  /** Rendered square size in pixels. */
  size?: number;
  className?: string;
};

/**
 * The lamp that sits beside a username.
 *
 * Green is "online now", yellow is "the site is open but nobody is using it",
 * red is "not on the site" (the tooltip says how long ago). It is a square lamp rather than a circle for the usual reason - nothing
 * on this site rounds a corner - and its three colours are swatches from
 * `name-colours.ts` (green / yellow / red), so it belongs to the same palette the
 * usernames use. Swap it for a hand-drawn sprite by pointing the span's style at
 * an `assets/` image instead: nothing else knows how the dot is painted.
 */
export default function StatusDot({ status, record, size = STATUS_DOT_SIZE, className }: StatusDotProps) {
  // The same box in the same place (Luke, 2026-11-07), so a private lamp moves nothing. The outline is in the field's own
  // ink, because a black box on a dark bar would otherwise vanish.
  if (status === 'private') {
    return (
      <span
        role="img"
        aria-label={PRIVATE_LAMP_LABEL}
        title={PRIVATE_LAMP_LABEL}
        className={`inline-block shrink-0 rounded-none border border-ink bg-hardware align-middle ${className ?? ''}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const label = presenceLabel(status);

  return (
    <span
      role="img"
      aria-label={label}
      title={presenceLine(status, record)}
      className={`inline-block shrink-0 rounded-none border border-ink-plate align-middle ${className ?? ''}`}
      style={{ width: size, height: size, backgroundColor: presenceDotColour(status) }}
    />
  );
}
