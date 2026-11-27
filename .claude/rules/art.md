---
paths:
  - "app/**/*.tsx"
  - "app/**/*.css"
  - "assets/**"
  - "app/lib/ui/art/**"
  - "app/lib/character/**"
  - "app/lib/companion/**"
  - "app/lib/backdrops/**"
  - "app/lib/aquarium/**"
  - "app/lib/leaguebot/**"
---
<!-- Moved word for word from .claude/rules/core.md on 2026-11-27 (Luke's context system). It loads when a file in this area is opened. -->
# Asset Rules
These are firm, unlike most of the design notes.
- No AI-generated artwork of any kind. All artwork is hand-drawn by me on a Kamvas tablet and added by hand.
  Three exceptions, my choice: the country flags in `assets/flags/` are a ready-made open set (MIT, 2026-11-03; see its README), `assets/icons/tmdb.png` is TMDB's own logo, which its API terms require (2026-11-05), and `assets/aquarium/` is the Windows 98 Underwater screensaver's own pictures for the AQUARIUM background (Microsoft's, 2026-11-15; see its README).
  A fourth (2026-11-17, SPEC-leaguebot.md, answer 7A): LEAGUEBOT shows Riot's own champion, item, rune and spell icons, rank crests and profile icons, loaded straight from Riot's Data Dragon and Community Dragon and never copied into `assets/`, with Riot's "not endorsed" notice under the window. Nothing else of Riot's: no splash art.
- Code never draws a character, icon or illustration (no CSS or SVG art). Repeating tile patterns, dithers and dotted lines are fine.
- A simulated background isn't artwork (Luke, 2026-11-16, for the backgrounds in `SPEC-backgrounds.md`): what a physics simulation produces behind the site (grains of sand, ink in water, stars, bouncing lines, fields of colour) may be drawn by code ("allow yourself liberty for the sake of quality and style"). It still never depicts a character, an icon or a scene: anything that does is my drawing or a named exception.
- Code-made motion isn't artwork (Luke, 2026-11-13): code may turn the joints of a character built by hand on the workbench and bake those frames to pictures (`app/lib/character/motion.ts`), but it never draws, adds shapes or makes new art.
- Smears on hand-built characters (Luke, 2026-11-16: "be leniant with the rules where necessary for the sake of creativity and fun"): code may stretch, shear and ghost (copy, fainter) the baked frames of his hand-built characters along their travel, as the companion does when it is dragged and thrown (`app/lib/companion/throw.ts`). Still never a new character or shape drawn from nothing.
- When something needs artwork, point at a placeholder file through a slot (`SpriteSlot`, the registry in `app/lib/ui/art/`) and stop. Don't make a stand-in.
