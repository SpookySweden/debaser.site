/**
 * The faces the site loads - the font registry.
 *
 * Each face is loaded once here and handed to the page as a CSS variable (`--face-*`). Which face does
 * which *job* (body, titles, fields, RADI-OH) is decided in `app/theme/tokens.css` (`--font-body` and the
 * rest), so a component never names a face and a swap never touches one.
 *
 * **Swapping the site's face is the import line below.** Change `DotGothic16` to another Google font
 * (`VT323`, `Silkscreen`, `Press_Start_2P`...) and every job that points at `--face-pixel` follows. Two
 * things to check after a swap, both in `docs/theming.md`: the weight (a face with several weights wants
 * `weight` listed, or dropped for a variable face), and `font-bold` - 457 elements carry it and it does
 * nothing today only because this face has one weight.
 *
 * DotGothic16 (SPEC-readability.md) is a thin dotted pixel face with a real lowercase, drawn on a 16px
 * grid: 16 and 32 are pixel-sharp, 13-15 slightly soft but readable. It has one weight, so `globals.css`
 * switches font synthesis off and emphasis comes from colour or size.
 *
 * For a face of your own, `next/font/local` loads a file: `localFont({ src: './my-face.woff2',
 * variable: '--face-pixel' })`.
 */
import { DotGothic16 as PixelFace } from 'next/font/google';

const pixel = PixelFace({
  variable: '--face-pixel',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

/** Every loaded face's variable, as the class list `<html>` wears. */
export const FACE_VARIABLES = [pixel.variable].join(' ');
