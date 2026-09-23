'use client';

import { useState } from 'react';
import { ASCII_EMOTICONS } from '../lib/comms/ascii-emoticons';
import { PLATE } from '../lib/ui/controls';

const CHIP =
  'cursor-pointer rounded-none border border-gray-500 bg-white px-1 py-[1px] font-mono text-[11px] text-black hover:bg-sun-pale';

type AsciiEmoticonPickerProps = {
  /** Where the emoticon goes: the caller knows its own caret. */
  onPick: (text: string) => void;
  disabled?: boolean;
};

/**
 * The emoticon shelf, behind one small button.
 *
 * Everything here is ASCII, because the site is: the faces are the ones a keyboard
 * makes, and there is not a single picture in the list - which also means an emoticon
 * survives being copied out of the site, mailed, or read by somebody with images
 * switched off. It opens over the composer rather than beside it, so a long shelf
 * never changes the shape of the page.
 */
export default function AsciiEmoticonPicker({ onPick, disabled = false }: AsciiEmoticonPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} disabled={disabled} className={PLATE}>
        {open ? '[ CLOSE SHELF ]' : '[ :) EMOTICONS ]'}
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-[22rem] rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-sun-pale p-2 shadow-none">
          <p className="text-[10px] font-bold text-black">
            TEXT FACES :: CLICK ONE TO DROP IT IN WHERE THE CARET IS
          </p>

          {ASCII_EMOTICONS.map((group) => (
            <div key={group.id} className="mt-2">
              <p className="text-[10px] font-bold text-gray-700">{group.label}</p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {group.emoticons.map((emoticon) => (
                  <li key={emoticon.text}>
                    <button
                      type="button"
                      onClick={() => onPick(emoticon.text)}
                      className={CHIP}
                      title={emoticon.about}
                    >
                      {emoticon.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <p className="mt-2 border-t border-gray-500 pt-1 text-[10px] text-gray-700">
            NO PICTURES, NO UNICODE: EVERY FACE HERE IS PLAIN TEXT, THE SAME AS TYPING IT.
          </p>
        </div>
      ) : null}
    </div>
  );
}
