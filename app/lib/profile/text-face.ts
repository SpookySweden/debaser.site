/**
 * The default face: what an account with no picture wears until Luke draws `assets/profiles/avatar-default.png`
 * (review fixes, 2026-11-17, Luke: "make a default silly art fitting the site").
 *
 * Built from text characters only (Luke, 2026-10-12: text-character art is allowed; nothing drawn, nothing generated).
 * Candidates tried: `(o_O)`, `(@_@)`, `[x_x]`, `( ._.)`. `(o_O)` won: the startled "who are you?" look matches the guest
 * strip's ERROR: UNREGISTERED ENTITY, and it shrinks to `o_O` and `:O` and still reads as a face at 20px. Every
 * character is plain ASCII, which the site's own font (IBM Plex Mono, latin) has, so no stand-in font is ever pulled in.
 *
 * Each size picks the largest site text size whose face still fits inside the frame (Plex Mono is 0.6em a character),
 * and never anything under 13px (`text-label`). `Temp/check-forumfix.cjs` holds every shown size to that.
 */
export type TextFace = {
  face: string;
  /** A site text size token (app/theme/tokens.css). */
  sizeClass: 'text-label' | 'text-title' | 'text-display' | 'text-headline';
  /** A second line, only where the frame has room for it. */
  caption?: string;
};

export function textFaceFor(size: number): TextFace {
  if (size >= 96) return { face: '(o_O)', sizeClass: 'text-headline', caption: 'WHO??' };
  if (size >= 76) return { face: '(o_O)', sizeClass: 'text-display' };
  if (size >= 50) return { face: '(o_O)', sizeClass: 'text-title' };
  if (size >= 42) return { face: '(o_O)', sizeClass: 'text-label' };
  if (size >= 26) return { face: 'o_O', sizeClass: 'text-label' };
  return { face: ':O', sizeClass: 'text-label' };
}
