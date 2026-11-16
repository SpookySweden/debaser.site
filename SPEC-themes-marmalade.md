# SPEC: the orange and green themes (MARMALADE, OVERDRIVE, TIGERBREAD, CLEMENTINE)

Luke, 2026-11-16, for his partner, who also uses DEBASER_OS. In his words: "her favourite colour is orange and i think
we should choose some pastel orange and green tones for some, copy the framework of the pink themes, where there is one
general theme and some sub themes to it, do some dark and overly digitally vibrant and sleek themes because she likes that
kind of look and often ups the digital vibrance on her own monitor, account slightly with these themes for the fact that
her monitor likely has high digital vibrance and contrast". Then: "include some variation and one theme subset called
tigerbread", "give tigerbread a few variants and add clemantime too as a unique one", and, offered three plans,
"add all and organise appropriately".

Status: **planned, waiting for Luke's OK to build.** Nothing here is built yet.

## Luke's answers (interview, 2026-11-16)

He took the recommended pick on all seven first-round questions:

1. **Name:** MARMALADE (orange; marmalade on tiger bread).
2. **Line-up:** pastel light options led by orange and by green, dark vibrant sleek options in orange neon and green neon,
   and TIGERBREAD. He then asked for more variety: TIGERBREAD with variants, CLEMENTINE as a theme of its own, and every
   option from all three plans kept.
3. **TIGERBREAD:** like the loaf. The desktop is the crust (toasted orange-brown, crackled) and the windows are the pale
   crumb, with deep brown words. The crackle is a repeating tile pattern, which the art rules allow.
4. **Vibrance:** bright but just short of full strength. Near-black windows (never pure black) and words a touch off-white
   in the sleek dark ones. Said once and accepted: colours tuned for a vibrance-boosted screen look harsher on a normal
   one, and colours already at full strength clip (go flat, neighbouring shades merge) when vibrance is boosted.
   Measured: the neons sit at 58-75% saturation (HSV), never 100%.
5. **Who gets them:** everyone, listed in PREFERENCES → THEME like SHERBET. A theme choice lives in each browser
   (`debaser.site.theme.v2`), so she picks it once on her computer. **No database change.**
6. **Desktops:** the pastel options get a coloured checker like SHERBET's. The sleek dark ones get a checker so faint
   it reads almost flat (dither contrast 1.05-1.3:1).
7. **Scope:** colours and the desktop texture only. Same fonts, layout and shapes. No glow, no motion.

## How they are organised (14 new themes, 4 new rows in the picker)

The picker goes one level deep (a family row, its options under it), so the themes are grouped by mood:

| Row | Kind | Options (id) |
|---|---|---|
| **MARMALADE** | family | PEACH `marmalade-peach`, PISTACHIO `marmalade-pistachio`, NECTARINE `marmalade-nectarine`, KIWI `marmalade-kiwi` (light pastels); MAGMA `marmalade-magma`, MOSS `marmalade-moss` (rich darks with coloured windows, as SHERBET has NIGHT) |
| **OVERDRIVE** | family | EMBER `overdrive-ember`, VOLT `overdrive-volt`, BLAZE `overdrive-blaze`, GLITCH `overdrive-glitch` (sleek near-black, neon: the "overly digitally vibrant" ones) |
| **TIGERBREAD** | family | CRUMB `tigerbread-crumb` (light), TOASTED `tigerbread-toasted` (dark), CHARRED `tigerbread-charred` (dark, vibrant) |
| **CLEMENTINE** | stand-alone | `clementine` (no options, like NIGROSINE and DEBASER) |

Where they came from: Plan 1 ORCHARD gave PEACH, PISTACHIO, EMBER and VOLT. Plan 2 ARCADE gave BLAZE and its green
theme, renamed GLITCH so VOLT keeps its name. Plan 3 MOLTEN gave the stronger pastels, renamed NECTARINE and KIWI so
the PEACH and PISTACHIO names aren't used twice, plus MAGMA and MOSS. Near-identical shades across plans were merged into
one dye each (one neon orange, one neon green, one burnt orange, one leaf green), so the swatch stays a swatch.

Picker order: after SHERBET, in the order above. Labels and hover notes (the picker's `note`, a few words):

- MARMALADE: `PASTEL PEACH AND PISTACHIO, TWO RICH DARKS.`
  - PEACH `PEACH WINDOWS ON MINT.` · PISTACHIO `PISTACHIO WINDOWS ON APRICOT.` · NECTARINE `STRONG PEACH ON FERN.` ·
    KIWI `STRONG GREEN ON PAPAYA.` · MAGMA `BURNT ORANGE WINDOWS, GOLD WORDS.` · MOSS `FOREST WINDOWS, LIME WORDS.`
- OVERDRIVE: `SLEEK BLACK WINDOWS, NEON WORDS.`
  - EMBER `NEON ORANGE ON BLACK.` · VOLT `NEON GREEN ON BLACK.` · BLAZE `CYAN AND ORANGE ON BLACK.` · GLITCH `MAGENTA AND GREEN ON BLACK.`
- TIGERBREAD: `CRUMB, CRUST AND CHAR.`
  - CRUMB `CREAM CRUMB ON CRACKLED CRUST.` · TOASTED `TOASTED WINDOWS ON THE CRUST.` · CHARRED `CHARCOAL AND GLOWING CRUST.`
- CLEMENTINE `ORANGE WINDOWS, LEAF GREEN.`

## What each looks like (in words)

**MARMALADE, light.** Pastels with black words. Every link is a deep colour from the other half of the family: forest
green on the orange ones, rust on the green ones.
- PEACH: soft peach windows, slightly deeper peach panels, forest-green links, apricot keys, burnt-orange title chips, a
  pale mint row under the pointer. Sage-green desktop with a peach checker.
- PISTACHIO: pale pistachio windows, rust-orange links, apricot keys, leaf-green chips, a peach pointed row. Apricot
  desktop with a pistachio checker.
- NECTARINE: a fuller, stronger peach than PEACH, papaya keys, a greengage pointed row, a fern-green desktop.
- KIWI: a fuller, stronger green than PISTACHIO, papaya keys, a nectarine pointed row, a papaya desktop.

**MARMALADE, dark.** The windows themselves are coloured.
- MAGMA: deep burnt-orange-brown windows, cream words, gold links, amber captions, neon-orange keys, black chips, a darker
  magma desktop.
- MOSS: deep forest-green windows, mint-white words, lime links, amber captions, neon-green keys, a darker moss desktop.

**OVERDRIVE.** Near-black windows tinted toward the theme's colour, off-white words, neon links and keys (black words on
the keys), and an almost flat desktop.
- EMBER: warm black, cream words, neon-orange links and keys, amber captions, burnt-orange chips.
- VOLT: green black, mint-white words, neon-green links and keys, kumquat-orange captions, leaf-green chips.
- BLAZE: blue black, lilac-white words, electric-cyan links, neon-orange keys, kumquat captions.
- GLITCH: green black, mint-white words, hot-magenta links, neon-green keys and captions.

**TIGERBREAD.**
- CRUMB: cream crumb windows, dark brown words, crust-brown links, golden keys, toast-brown chips, a butter-yellow
  pointed row. Crust desktop (toasted orange-brown) with dark brown crackle.
- TOASTED: toasted-brown windows, cream words, gold links, pale toasted-orange captions, golden keys, black chips, on the
  same crackled crust desktop. Its music queue shows already-played songs in Candy, because Light Red is 4.41:1 on its brown.
- CHARRED: charcoal windows (EMBER's warm black), cream words, glowing neon-orange links, gold captions. Near-flat charcoal desktop.

**CLEMENTINE.** The whole fruit, and the one bright, saturated light theme: vivid clementine windows, black words, dark
leaf-green links, lime-leaf keys, leaf-green chips, a pith-coloured pointed row. Leaf-green desktop with an orange checker.

Swatch mock-ups were shown to Luke in the session. The palettes as data (dye names, every token for all 14 themes) are kept outside the repo in the session group's notes folder as `marmalade-palettes.cjs`; the tables below are the source of truth.

## Build notes

- `app/lib/ui/themes.ts`: the new dyes go in `DYES` with a comment block per swatch, as SHERBET's has (names and hexes in
  the table at the end). Four `ThemeFamily`s (MARMALADE, OVERDRIVE, TIGERBREAD; CLEMENTINE has none), 14 `Theme`s, the
  `ThemeId` union, and `THEMES` in the order above. Shared parts as the existing themes have them: `ink-plate` Black,
  `ink-bar` White, `hardware` Black, faults and BARR in Rose, the cover card and reader tokens unchanged (`READER_TOKENS`).
  The light themes take Deep Red / Deep Green / Royal Blue for the queue and the dark ones Light Red / Emerald / Light Blue,
  except TOASTED's played songs (Candy). Light themes: `ice`, `ice-pale`, `chrome-dark` and `acid-pale` are the panel
  colour, and `chrome` is Nigrosine (Crust Shadow on CRUMB). Dark themes: `sun-pale`, `ice` and `acid-pale` are the window
  colour, and `chrome`, `chrome-dark`, `ice-pale` and `ena-deep` are Black. `pointed-quiet` is White on the light ones
  (Pith White on CLEMENTINE); on the dark ones it's the pointed colour, except Black on MAGMA and MOSS and Crust Ink on TOASTED.
- MOSS reuses SHERBET's Lime. Every other MARMALADE colour is new.
- `npm run tokens -- --write` regenerates `app/theme/tokens.css`.
- `Temp/check-themes.cjs` pins every dye and says where each may be worn (`wornAllowed`). Add the new swatch to it as
  SHERBET's was added: a change made on purpose, said in the commit.
- `scripts/contrast.cjs`: add the 14 ids to `THEME_IDS`.
- `docs/design.md`: a short "Palette: MARMALADE" section like SHERBET's, listing which families wear it.
- **The crackle.** TIGERBREAD CRUMB and TOASTED draw the desktop as a crackle instead of the 4px checker: an irregular
  network of thin dark lines on the crust, as a repeating tile in `desktop-dither` on `desktop`. Proposed mechanism: an
  optional `tile?: 'crackle'` on `Theme`, written by `applyTheme` and the boot script as `data-tile` on `<html>` before
  the first paint, and a `[data-tile='crackle'] .desktop-tile` rule in `globals.css`. Colours stay `var()`s (a mask or
  gradients, never a hex in a data URI), and `--art-desktop-tile` still wins if a file is filed. The scrollbar trough keeps
  the checker. A pattern, not a picture (core.md's Asset Rules: "Repeating tile patterns, dithers and dotted lines are fine").
- **The desktop only shows on the TILE backdrop.** AQUARIUM has been the default backdrop since 2026-11-15, and the
  simulated backgrounds replace the tile too. Her desktop colours and the crackle show once her backdrop is set to TILE in
  PREFERENCES. The themes don't switch the backdrop (out of scope).
- Other code that walks `THEMES` and may surface a pair to adjust: the MODULOS hover colours (read against each theme's
  `sun-pale`), people's name colours and their outlines on bright themes (`Temp/check-name-colour.cjs`), the split key's
  halves (`Temp/check-media-list.cjs`), and the literal-pair scan in `check-themes.cjs` step 5 (every `text-X bg-Y` in the
  source, in every theme). A pair that fails there gets the smallest nudge to a dye, and the tables below are updated with it.

## Proof

- `npm run verify` (tokens, typecheck, build) and `npm run checks:changed`. It will pick the theme checks; the
  `FULL RUN DUE` rule applies (a SPEC-built feature runs the whole suite).
- `npm run contrast` against a local mock dev server, for each of the 14 ids: no pair under its floor, nothing invisible.
  A browser step, so it goes through the shared `heavy-step.cjs`.
- `npm run capture` then `npm run audit`.
- Live: merge origin/main, one `npm run verify:clean` (via `heavy-step.cjs`), push, `npm run deploy-status`, then
  `npm run read -- --url <site>/specimen` expecting `CLEMENTINE` and `TIGERBREAD` (the specimen lists every theme).
- No screenshots to Luke and no live browser drive: the picker is client-side, and the specimen read proves it's live.

## Out of scope

Fonts, layout, shapes, glow or any new effect; motion; the backdrops (AQUARIUM, simulated backgrounds); making a theme
hers only, or saving the choice to her account (that would be a database change); phone-specific work (desktop first).

## Palettes and measured contrast

Every pair below clears 4.5:1 (computed with the WCAG formula, the same one `check-themes.cjs` uses). The dye-by-job
tables name each theme's dyes; the hexes are in the dye table at the end. "Key under pointer" is the window colour
printed on the link colour, the fill a bracket key takes when pointed at.

### MARMALADE: dyes by job

| option | windows | panels | words | links | captions | keys | title chips | pointed row | split key 1 / status | split key 2 | desktop | dither | checkbox |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PEACH | peach | nectar | black | forest | nigrosine | apricot | burntOrange | honeydew | spearmint | apricot | sage | peach | forest |
| PISTACHIO | pistachio | pistachioDeep | black | rust | nigrosine | apricot | leaf | peach | spearmint | apricot | apricot | pistachio | rust |
| NECTARINE | nectarine | nectarineDeep | black | forest | nigrosine | papaya | burntOrange | greengage | spearmint | papaya | fern | nectarine | forest |
| KIWI | kiwi | kiwiDeep | black | rust | nigrosine | papaya | leaf | nectarine | spearmint | papaya | papaya | kiwi | rust |
| MAGMA | magma | magma | cream | gold | amber | neonOrange | black | magmaGlow | neonGreen | neonOrange | magmaDeep | magma | gold |
| MOSS | moss | moss | mintWhite | lime | amber | neonGreen | black | mossGlow | lime | kumquat | mossDeep | moss | lime |

| option | words on windows | links on windows | captions | words on panels | key labels | chip words | words on pointed row | links on pointed row | key under pointer |
|---|---|---|---|---|---|---|---|---|---|
| PEACH | 15.81 | 6.51 | 13.42 | 13.73 | 10.74 | 6.09 | 16.58 | 6.83 | 6.51 |
| PISTACHIO | 17.23 | 6.43 | 14.62 | 15.24 | 10.74 | 6.21 | 15.81 | 5.91 | 6.43 |
| NECTARINE | 14.02 | 5.78 | 11.90 | 12.27 | 9.67 | 6.09 | 16.03 | 6.60 | 5.78 |
| KIWI | 16.60 | 6.20 | 14.09 | 14.68 | 9.67 | 6.21 | 14.02 | 5.24 | 6.20 |
| MAGMA | 14.51 | 9.93 | 10.79 | 14.51 | 9.15 | 21.00 | 10.79 | 7.39 | 9.93 |
| MOSS | 12.94 | 11.44 | 9.02 | 12.94 | 14.54 | 21.00 | 8.74 | 7.73 | 11.44 |

### OVERDRIVE: dyes by job

| option | windows | panels | words | links | captions | keys | title chips | pointed row | split key 1 / status | split key 2 | desktop | dither | checkbox |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMBER | emberBlack | emberBlack | cream | neonOrange | amber | neonOrange | burntOrange | emberGlow | neonGreen | neonOrange | emberDesk | emberDither | neonOrange |
| VOLT | voltBlack | voltBlack | mintWhite | neonGreen | kumquat | neonGreen | leaf | voltGlow | neonGreen | kumquat | voltDesk | voltDither | neonGreen |
| BLAZE | blazeBlack | blazeBlack | lilacWhite | cyan | kumquat | neonOrange | burntOrange | blazeGlow | neonGreen | neonOrange | blazeBlack | blazeDither | cyan |
| GLITCH | voltBlack | voltBlack | mintWhite | magenta | neonGreen | neonGreen | leaf | glitchGlow | neonGreen | magenta | voltBlack | voltDesk | magenta |

| option | words on windows | links on windows | captions | words on panels | key labels | chip words | words on pointed row | links on pointed row | key under pointer |
|---|---|---|---|---|---|---|---|---|---|
| EMBER | 17.13 | 8.32 | 12.74 | 17.13 | 9.15 | 6.09 | 13.44 | 6.53 | 8.32 |
| VOLT | 18.04 | 13.08 | 9.37 | 18.04 | 14.54 | 6.21 | 11.54 | 8.36 | 13.08 |
| BLAZE | 17.54 | 14.06 | 9.66 | 17.54 | 9.15 | 6.09 | 14.48 | 11.61 | 14.06 |
| GLITCH | 18.04 | 7.44 | 13.08 | 18.04 | 14.54 | 6.21 | 11.55 | 4.76 | 7.44 |

### TIGERBREAD: dyes by job

| option | windows | panels | words | links | captions | keys | title chips | pointed row | split key 1 / status | split key 2 | desktop | dither | checkbox |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CRUMB | crumb | crumbDeep | crustInk | crust | crumbQuiet | golden | toast | butter | wheat | crustOrange | crustDesk | crackle | crust |
| TOASTED | toasted | toasted | crumb | gold | toastedPale | golden | black | toastedGlow | wheat | crustOrange | crustDesk | crackle | gold |
| CHARRED | emberBlack | emberBlack | crumb | neonOrange | gold | neonOrange | burntOrange | emberGlow | gold | neonOrange | charcoalDesk | emberBlack | neonOrange |

| option | words on windows | links on windows | captions | words on panels | key labels | chip words | words on pointed row | links on pointed row | key under pointer |
|---|---|---|---|---|---|---|---|---|---|
| CRUMB | 15.17 | 6.91 | 9.84 | 13.01 | 9.81 | 9.04 | 11.79 | 5.37 | 6.91 |
| TOASTED | 11.51 | 8.04 | 7.53 | 11.51 | 9.81 | 21.00 | 8.22 | 5.74 | 8.04 |
| CHARRED | 16.79 | 8.32 | 11.72 | 16.79 | 9.15 | 6.09 | 13.18 | 6.53 | 8.32 |

### CLEMENTINE: dyes by job

| option | windows | panels | words | links | captions | keys | title chips | pointed row | split key 1 / status | split key 2 | desktop | dither | checkbox |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CLEMENTINE | clementine | clementineLight | black | leafDark | crustInk | limeLeaf | leafGreen | pith | limeLeaf | pithWhite | leafGreen | clementine | leafDark |

| option | words on windows | links on windows | captions | words on panels | key labels | chip words | words on pointed row | links on pointed row | key under pointer |
|---|---|---|---|---|---|---|---|---|---|
| CLEMENTINE | 10.30 | 5.91 | 8.47 | 12.24 | 15.69 | 8.40 | 14.74 | 8.46 | 5.91 |

### New dyes

| name | hex |
|---|---|
| peach | #ffd8bd |
| nectar | #ffc59e |
| apricot | #ffa463 |
| burntOrange | #a8420b |
| honeydew | #c9efbf |
| spearmint | #8fe39a |
| sage | #a7dc9c |
| forest | #14572b |
| pistachio | #d5f1c6 |
| pistachioDeep | #bfe7ac |
| rust | #8f3500 |
| leaf | #2a6e37 |
| nectarine | #ffc8a0 |
| nectarineDeep | #ffb683 |
| papaya | #ff9550 |
| greengage | #b7f0a6 |
| fern | #8fe08a |
| kiwi | #c2f2ad |
| kiwiDeep | #aae894 |
| magma | #3a1607 |
| magmaGlow | #5e2509 |
| magmaDeep | #250d03 |
| moss | #0f3521 |
| mossGlow | #1a5232 |
| mossDeep | #08200f |
| cream | #fff0e3 |
| mintWhite | #eafff1 |
| lilacWhite | #f5f1ff |
| emberBlack | #150e0a |
| emberGlow | #3d1f0d |
| emberDesk | #1e130c |
| emberDither | #26180f |
| voltBlack | #0a130e |
| voltGlow | #123e23 |
| voltDesk | #0c1a12 |
| voltDither | #112318 |
| blazeBlack | #0e0b16 |
| blazeGlow | #22194a |
| blazeDither | #16112a |
| glitchGlow | #173d2a |
| neonOrange | #ff8d45 |
| neonGreen | #5df28c |
| cyan | #45f0ff |
| magenta | #ff6ad5 |
| amber | #ffc98e |
| kumquat | #ffa057 |
| gold | #f6c35e |
| crumb | #fbefd9 |
| crumbDeep | #f2ddb9 |
| crustInk | #2a1607 |
| crust | #8a390a |
| crumbQuiet | #55331a |
| toast | #76370f |
| golden | #e9a34e |
| butter | #f6d08f |
| wheat | #f0c062 |
| crustOrange | #ee9152 |
| crustShadow | #3a1f0c |
| crustDesk | #b5622a |
| crackle | #5c2b0f |
| toasted | #4a2812 |
| toastedGlow | #6b3a19 |
| charcoalDesk | #2a160b |
| toastedPale | #ffb38a |
| clementine | #ff9f45 |
| clementineLight | #ffb76b |
| pith | #ffd09a |
| leafDark | #0c3f1b |
| leafGreen | #17592a |
| limeLeaf | #b7f06a |
| pithWhite | #fff3d6 |

