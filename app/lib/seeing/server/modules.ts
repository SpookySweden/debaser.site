/**
 * Module scripts (SPEC-seeing-machine.md, "Scripts on"): a module names the others it needs by address, and each is signed. Only the
 * plain shapes are read (`import x from "./y.js"`, `export ... from`, `import "./y.js"`, `import("./y.js")` with a written address); one
 * made up as the script runs can't be, and is refused by the frame's policy. Pure.
 */

/** A written address, not a bare name (`react`), which a page's import map or nothing would resolve. */
const isAddress = (text: string): boolean => /^(?:\.{0,2}\/|https?:\/\/)/i.test(text);

const SHAPES = /(\b(?:from|import)\s{0,20}\(?\s{0,20})(["'])((?:(?!\2)[^\\\n]){1,2000})\2/g;

export function rewriteImports(script: string, to: (address: string) => string | null): string {
  return script.replace(SHAPES, (whole, before: string, quote: string, address: string) => {
    if (!isAddress(address)) return whole;
    const answer = to(address);
    // Nothing that loads: a module that must not be fetched is an empty one. In the quotes it came in, so words inside a string of the
    // script's own that happen to read like this stay a string.
    return `${before}${quote}${(answer ?? 'data:text/javascript,').replace(/["'\\\n]/g, encodeURIComponent)}${quote}`;
  });
}

/**
 * Where a script thinks it is. The frame's own address is `about:srcdoc`, which can be neither read nor moved, so the plain ways of asking
 * where the page is, or sending it on, are pointed at a stand-in the hook makes (`__seeLocation`). Only shapes that can mean nothing else:
 * `window.location`, and a bare `location` that is written to, or asked for a part only the real one has. A help to pages, not a guard.
 */
export function rewriteLocation(script: string): string {
  return script
    .replace(/(?<![\w$.])(?:window|self|globalThis|top|parent|document)\s{0,20}\.\s{0,20}location(?![\w$])(?!\s*:)/g, 'window.__seeLocation')
    .replace(/(?<![\w$.])(?<!(?:var|let|const|function|class)\s)location(?=\s{0,20}\.\s{0,20}(?:href|assign|replace|reload|host|hostname|origin|protocol|port)(?![\w$])|\s{0,20}=(?![=>]))/g, (found, at: number, all: string) =>
      // `{ a, location = 1 }` and `(location = 1) =>` name a thing of the script's own.
      /[{(,]\s*$/.test(all.slice(Math.max(0, at - 20), at)) && /^location\s*=/.test(all.slice(at, at + 40)) ? found : '__seeLocation',
    );
}
