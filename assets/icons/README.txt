SIGN-IN ICONS
=============

Icons for the sign-in buttons live here, drawn by hand like everything else in
this folder: nothing on the site draws a logo in CSS or in SVG, and no icon is
generated.

assets/icons/google-retro.png   the Google key beside "[ LOG IN ]" (both start Google sign-in)

Notes
-----
- Square, transparent background, and drawn at 40x40: the button draws it at
  20x20, so 40 is `k=2` and stays whole pixels on a 2x screen as well as a 1x
  one (assets/README.txt - `natural = shown x k`, with k a whole number). This
  README said "64x64 or larger" until 2026-10-04, which is x3.2 and gets blurred
  by the browser; `npm run art` refuses a size that is not a whole multiple.
- "Retro" is the point: the mark as a 90s browser or a Win95 application would
  have drawn it, not the current flat one.
- Until the file exists the key reads "[ G ]" (Luke's choice, 2026-10-25), and
  nothing else has to change when it lands: the picture replaces the words in the
  same box once it has loaded. On a phone the key keeps a 44px tap area around it.

The path is set in app/lib/auth/google.ts (GOOGLE_ICON_SRC).
