app/theme/faces/

ibm-plex-mono-600-latin.woff2
  IBM Plex Mono SemiBold (weight 600), Latin subset, exactly as Google Fonts serves it (it is the file
  next/font/google downloaded for the site's build on 2026-11-14). Loaded by app/theme/fonts.ts as the
  site's one heavier weight (`--face-strong`, worn through `font-strong`), Luke's OK 2026-11-14.

  Why here and not through next/font/google: a second Google load of the same face joins the site's
  400-only family, which would make every `font-bold` on the site heavy. A local file is a family of its own.

  Copyright 2017 IBM Corp. with Reserved Font Name "Plex".
  Licensed under the SIL Open Font License, Version 1.1: https://openfontlicense.org
  (the same licence as the 400 face the site already loads from Google Fonts). The font may be used,
  bundled and served with the site; it must not be sold on its own, and a changed version must not be
  called "Plex". This file is unchanged.

A font is not artwork: the asset rules in .claude/rules/core.md are about drawings.
