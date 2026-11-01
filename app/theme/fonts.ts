/**
 * The faces the site loads - the font registry.
 *
 * Each face is loaded once here and handed to the page as a CSS variable (`--face-*`). Which face does
 * which *job* (body, titles, fields, RADI-OH) is decided in `app/theme/tokens.css` (`--font-body` and the
 * rest), so a component never names a face and a swap never touches one.
 *
 * **Swapping the site's face is the import line below.** Change `IBM_Plex_Mono` to another Google font
 * (`VT323`, `Silkscreen`, `Press_Start_2P`...) and every job that points at `--face-pixel` follows. Two
 * things to check after a swap, both in `docs/theming.md`: the weight (a face with several weights wants
 * `weight` listed, or dropped for a variable face), and `font-bold` - about 450 elements carry it and it
 * does nothing today only because one weight is loaded.
 *
 * IBM Plex Mono (SPEC-efficiency.md, 2026-10-23) replaced DotGothic16, a dotted pixel face whose capitals
 * smeared at 13-15px. It is a monospace with open, even letters, and it sets everything, titles too. Only
 * weight 400 is loaded, so `globals.css`'s `font-synthesis: none` keeps every `font-bold` inert and
 * emphasis still comes from colour or size. It is about 20% wider than DotGothic16 (0.6em a letter, not
 * 0.5em). The variable keeps its old name, `--face-pixel`: it means "the site's face".
 *
 * For a face of your own, `next/font/local` loads a file: `localFont({ src: './my-face.woff2',
 * variable: '--face-pixel' })`.
 */
import { IBM_Plex_Mono as PixelFace } from 'next/font/google';

const pixel = PixelFace({
  variable: '--face-pixel',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

/** Every loaded face's variable, as the class list `<html>` wears. */
export const FACE_VARIABLES = [pixel.variable].join(' ');
