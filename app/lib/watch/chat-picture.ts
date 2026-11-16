import { chatImageUrl } from './chat-images';
import { PICTURE_EXTENSIONS, isTrustedPicture, outsideAddressRefusal } from './pictures';

/**
 * A line of room chat that is a picture (ROOMSYNC, Luke 2026-11-16: "when a user sends a gif or image, have the companion
 * raise it rather than sending the text of the url"): the whole line is one address, and it is plainly a picture.
 *
 * - A GIPHY or Wikimedia Commons picture (`chatImageUrl`, what the room's own picture search sends), or one of the site's
 *   own or a MEDIA platform's pictures (`isTrustedPicture`): drawn at once, as before.
 * - Any other public https address whose file name says it is a picture (`.gif`, `.png`, `.jpg`...): an **outside
 *   picture**, which follows the viewer's OUTSIDE PICTURES choice (covered with SHOW unless they said otherwise,
 *   `outside-pictures.ts`), passes the address rules (`outsideAddressRefusal`: no SVG, nothing on a private network)
 *   and is checked again in each viewer's browser before it shows. Hotlinked, never copied or stored by the site.
 *
 * Anything else is words, drawn as plain text. A guest's line is always words (pictures are for accounts, SPEC-guests.md).
 * Pure: the chat window, the room's feed and the companion share this one rule.
 */
export type ChatPicture = { url: string; outside: boolean };

/** Longer than this is not taken as a picture address. */
const LONGEST = 2048;

export function chatPicture(body: string, guest: boolean): ChatPicture | null {
  if (guest) return null;
  const text = body.trim();
  if (text.length === 0 || text.length > LONGEST || /\s/.test(text)) return null;
  const known = chatImageUrl(text);
  if (known !== null) return { url: known, outside: false };
  if (!text.toLowerCase().startsWith('https://')) return null;
  if (isTrustedPicture(text)) return { url: text, outside: false };
  if (outsideAddressRefusal(text) !== null) return null;
  let path: string;
  try {
    path = new URL(text).pathname.toLowerCase();
  } catch {
    return null;
  }
  const dot = path.lastIndexOf('.');
  if (dot === -1 || !PICTURE_EXTENSIONS.includes(path.slice(dot + 1))) return null;
  return { url: text, outside: true };
}
