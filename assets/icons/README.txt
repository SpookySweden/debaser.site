SIGN-IN ICONS
=============

Icons for the sign-in buttons live here, drawn by hand like everything else in
this folder: nothing on the site draws a logo in CSS or in SVG, and no icon is
generated.

assets/icons/google-retro.png   the mark on the "LOG IN WITH GOOGLE" button

Notes
-----
- Square, transparent background, 64x64 or larger; the button draws it at 20x20
  inside its own bordered box, so keep the letterforms big in the frame.
- "Retro" is the point: the mark as a 90s browser or a Win95 application would
  have drawn it, not the current flat one.
- Until the file exists the button shows "[ ? ]" in the icon box (the same
  placeholder every missing drawing gets), and nothing else has to change when it
  lands.

The path is set in app/lib/auth/google.ts (GOOGLE_ICON_SRC).
