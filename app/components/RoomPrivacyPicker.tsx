'use client';

import { useState } from 'react';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { ROOM_PASSWORD_MAX, roomPrivacyLabel } from '../lib/watch/rules';
import type { RoomPrivacy } from '../lib/watch/types';

const CHOICES: readonly RoomPrivacy[] = ['private', 'password', 'open'];

/**
 * WHO CAN JOIN (SPEC-privacy-phase-2.md): the three keys, and a PASSWORD field while PRIVATE + PASSWORD is picked. The same
 * words in the GO LIVE window and the room's cog. The field is dots until `[ SHOW ]` is pressed.
 */
export default function RoomPrivacyPicker({
  value,
  onChange,
  password,
  onPassword,
  passwordLabel = 'PASSWORD',
  autoFocus = false,
}: {
  value: RoomPrivacy;
  onChange: (next: RoomPrivacy) => void;
  password: string;
  onPassword: (next: string) => void;
  passwordLabel?: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className="flex flex-col gap-2 text-ink">
      <div role="radiogroup" aria-label="Who can join" className="flex flex-wrap items-center gap-1">
        <span className="font-bold">WHO CAN JOIN:</span>
        {CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={value === choice}
            className={`${value === choice ? PLATE_PRESSED : PLATE} max-sm:min-h-tap`}
            onClick={() => onChange(choice)}
            data-room-privacy={choice}
          >
            {`[ ${roomPrivacyLabel(choice)} ]`}
          </button>
        ))}
      </div>
      {value === 'password' ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1 font-bold">
            {passwordLabel}
            <input
              type={shown ? 'text' : 'password'}
              value={password}
              maxLength={ROOM_PASSWORD_MAX}
              autoComplete="new-password"
              autoFocus={autoFocus}
              onChange={(event) => onPassword(event.target.value)}
              className={`${FIELD_TIGHT} min-w-0 font-normal`}
              data-room-password
            />
          </label>
          <button type="button" className={`${PLATE} max-sm:min-h-tap`} aria-pressed={shown} onClick={() => setShown((was) => !was)}>
            {shown ? '[ HIDE ]' : '[ SHOW ]'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
