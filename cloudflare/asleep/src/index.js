/*
 * debaser-asleep: a Cloudflare Worker in front of https://debaser.site (Luke, list 5, HOSTING: "A 'sleeping' page for when
 * your PC is off. Right now visitors get a bare Cloudflare error"). It runs on Cloudflare, not on Luke's PC.
 *
 * Every request goes straight on to the site. Only when the answer says the site could not be reached at all - the
 * tunnel is down because the PC is off or offline (Cloudflare's 530 / error 1033), or the tunnel is up but nothing
 * answers behind it (502, 504, Cloudflare's 52x) - does it answer instead: the asleep page for a page visit, a short JSON
 * answer for /api/* (so the site's own scripts read it as data). A 503 from the site itself is the site's own answer and
 * passes through. A quick 502 is asked once more a second later (GET/HEAD only), so a self-update's few-second switch
 * doesn't flash the page. api.debaser.site has no route to this Worker, so its errors stay as they were.
 *
 * The page is text characters only (no drawn art), in the site's own colours, written out here because the site's
 * stylesheet can't be loaded while it sleeps. It asks /api/version every 30 seconds and reloads itself when the site wakes.
 */

const UNREACHABLE = new Set([502, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);
const RETRY_AFTER_MS = 1200;

export default {
  async fetch(request) {
    const reusable = request.method === 'GET' || request.method === 'HEAD';
    let response = await reach(request);
    if (reusable && response !== null && response.status === 502) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
      response = await reach(request);
    }
    if (response !== null && !UNREACHABLE.has(response.status)) return response;
    return asleep(request);
  },
};

async function reach(request) {
  try {
    return await fetch(request);
  } catch {
    return null;
  }
}

export function asleep(request) {
  const url = new URL(request.url);
  const headers = { 'cache-control': 'no-store', 'retry-after': '120', 'x-debaser-asleep': '1' };
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'DEBASER_OS IS ASLEEP', asleep: true }), {
      status: 503,
      headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return new Response(request.method === 'HEAD' ? null : PAGE, { status: 503, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>DEBASER_OS IS ASLEEP</title>
<style>
  :root { --paper: #1a1525; --ink: #ffffff; --quiet: #e1ff00; --acid: #28c745; --bubble: #ff00a0; }
  html, body { margin: 0; height: 100%; background: var(--paper); color: var(--ink); }
  body { display: flex; align-items: center; justify-content: center; font: 16px/1.6 'Courier New', ui-monospace, monospace; letter-spacing: 0.04em; }
  main { max-width: 34rem; padding: 2rem 1.25rem; }
  pre { margin: 0 0 1.25rem; color: var(--quiet); font: inherit; white-space: pre; overflow: hidden; }
  h1 { margin: 0 0 0.75rem; font-size: 1.5rem; font-weight: bold; }
  p { margin: 0 0 1rem; }
  .bar { display: inline-block; background: var(--bubble); color: var(--ink); padding: 0 0.4rem; font-weight: bold; }
  .quiet { color: var(--quiet); }
  a { color: var(--acid); }
  a:focus-visible { outline: 2px dotted var(--quiet); outline-offset: 2px; }
  @media (prefers-reduced-motion: no-preference) { .blink { animation: blink 1.2s steps(1) infinite; } }
  @keyframes blink { 50% { opacity: 0; } }
</style>
</head>
<body>
<main>
<pre aria-hidden="true">┌──────────────────────────────┐
│  DEBASER_OS  ::  POWER: OFF  │
└──────────────────────────────┘</pre>
<p><span class="bar">■ OFFLINE</span></p>
<h1>DEBASER_OS IS ASLEEP<span class="blink" aria-hidden="true">_</span></h1>
<p>THE MACHINE THAT RUNS THIS PLACE IS SWITCHED OFF. COME BACK LATER.</p>
<p class="quiet" id="status" role="status">THIS PAGE WAKES BY ITSELF WHEN THE SITE DOES.</p>
<p><a href="">[ TRY AGAIN ]</a></p>
</main>
<script>
  // Asks the site every 30 seconds; when it answers, the page the visitor asked for loads.
  setInterval(function () {
    fetch('/api/version', { cache: 'no-store' }).then(function (r) { if (r.ok) location.reload(); }).catch(function () {});
  }, 30000);
</script>
</body>
</html>`;
