# foliate-js, pinned for the DEBASER reader

The engine behind `/read/<ref>` and `/read` (SPEC-reader.md, Luke 2026-11-11). It turns an EPUB or a PDF into pages:
the chapters, the two-page spread, CFI positions (the standard address of a spot in an e-book), search, and the layer
highlights are drawn on (EPUBs only: a PDF's fixed pages have no highlight layer).

- Source: https://github.com/johnfactotum/foliate-js
- Pinned at commit `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01). Copied 2026-11-11.
- Licence: MIT, `LICENSE` (Copyright (c) 2022 John Factotum).
- `vendor/zip.js` is zip.js by Gildas Lormeau, minified by foliate-js's own build: BSD 3-Clause,
  `vendor/LICENSE-zip.js.txt`. It reads the EPUB's zip in the browser (web workers off).
- `vendor/pdfjs/pdf.mjs` is Mozilla's pdf.js, the official 5.5.207 release (`pdfjs-dist@5.5.207`, `build/pdf.mjs`):
  Apache 2.0, `vendor/pdfjs/LICENSE`. Its worker, styles, character maps, fonts, colour profiles and WebAssembly image
  decoders (JPEG 2000, JBIG2, each with its own licence in `wasm/`) are served from `public/vendor/pdfjs/`, from the
  same release. Without the decoders an Internet Archive scan's pages draw white.
- No CDN at run time: the site's bundler builds these files in, and the rest is served by the site itself.

## Only what EPUB and PDF need
Copied: `view.js`, `epub.js`, `epubcfi.js`, `paginator.js`, `fixed-layout.js`, `overlayer.js`, `progress.js`,
`search.js`, `text-walker.js`, `tts.js` (view.js imports it; the site doesn't use it), `pdf.js`, `vendor/zip.js`,
`vendor/pdfjs/pdf.mjs`.
Left out: the comic book, FB2 and MOBI readers, `dict.js`, `opds.js`, `footnotes.js`, the demo reader
(`reader.html`, `reader.js`, `ui/`).

## The changes from upstream (each marked `DEBASER`)
- `view.js`, `makeBook`: EPUB and PDF only, from a Blob (or the site's slicer, `remotePdf` in
  `app/lib/books/reader-engine.ts`) only. An address is refused, so the engine never fetches a book itself; the site
  hands it what its own route passed through, or the reader's own file. The other formats' branches are cut.
- `paginator.js`, the touch handlers: a swipe snaps to the next page when the zoom didn't change during it, instead of
  only at zoom 1. Phones get the site laid out at 1280px and shrunk to fit (`app/layout.tsx`), so their zoom is never
  1, and upstream's test left every swipe half-turned there.
- `pdf.js`: pdf.js's helper files come from the site's `/vendor/pdfjs/`; `wasmUrl` and `iccUrl` are given; and only the
  pages being read are fetched, in half-megabyte slices (`rangeChunkSize`, `disableAutoFetch`, `disableStream`), so a
  scan of hundreds of megabytes is never pulled whole.

## Scripts in books
foliate-js frames each chapter with `sandbox="allow-same-origin allow-scripts"` (a WebKit bug needs
`allow-scripts` for events). The site stops book scripts itself, in `app/lib/books/reader-engine.ts`: script files
are refused before they load, and every EPUB chapter has its `<script>` elements and `on...` attributes removed and a
Content-Security-Policy written into its head (no scripts at all; pictures, styles and fonts only from the book
itself) before the engine draws it. A PDF page is drawn by pdf.js (a picture and its words, `isEvalSupported` off);
the PDF's own scripts never run.

## Updating
Clone upstream, copy the same files over these, re-apply the changes above, update the commit above; take pdf.js from
the `pdfjs-dist` release foliate-js names; and run `npm run checks -- --only check-reader`.
