debaser-asleep: the "DEBASER_OS IS ASLEEP" page (list 5, HOSTING; Luke 2026-11-20)

A Cloudflare Worker in front of https://debaser.site. It runs on Cloudflare, not on Luke's PC. It passes every request
to the site, and only when the site can't be reached (PC off or offline: Cloudflare 530 / error 1033; nothing behind
the tunnel: 502/504/52x) answers with the asleep page, or with {"error":"DEBASER_OS IS ASLEEP"} for /api/*. A 502 is
asked once more a second later, so a self-update's switch doesn't flash the page. api.debaser.site is not routed.

Deploy (from this folder, on the desktop; Wrangler is signed in to Luke's Cloudflare account):
    npx wrangler deploy
After a deploy, check in the dashboard (Workers Routes -> debaser.site/* -> Edit -> Request limit failure mode) that it
still says "Fail open (proceed)": over the free 100,000 requests a day, visitors then pass straight through.

Test address: sleep-test.debaser.site points at the tunnel debaser-sleep-test, which never runs, so it always fails the way
a switched-off PC does and always shows the page (G:\DEBASER-HOST\cloudflared\sleep-test holds that tunnel's credentials).
Check: node Temp/check-asleep-worker.cjs (npm run checks -- --only check-asleep-worker).

The down alert is Cloudflare's own: Notifications -> "debaser.site: your PC (tunnel debaser-home) went down or came back",
a Tunnel health alert by email for the tunnel debaser-home, any health change.
