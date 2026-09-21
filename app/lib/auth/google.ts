/**
 * Google sign-in.
 *
 * One place for the two things the button cannot work out for itself: where the
 * hand-drawn retro Google mark lives, and what to say when the backend cannot do
 * OAuth at all.
 *
 * The mark is a drawing like every other one on this site: it is hand-made on the
 * tablet, saved here by hand, and shown through the same slot component the
 * concept sheets use - so a missing file reads "[ ? ]" rather than a broken image,
 * and nothing about the logo is drawn in CSS or SVG.
 *
 * The message is the mock backend's answer (see ./mock-auth.ts). Supabase runs the
 * real exchange instead (see ./supabase-auth.ts), which is why the button stops
 * needing it the moment the backend is switched on.
 */
export const GOOGLE_ICON_SRC = '/assets/icons/google-retro.png';

export const GOOGLE_NEEDS_SUPABASE =
  'GOOGLE SIGN-IN NEEDS SUPABASE AUTH - ENABLE THE GOOGLE PROVIDER, THEN SET NEXT_PUBLIC_AUTH_BACKEND=supabase.';
