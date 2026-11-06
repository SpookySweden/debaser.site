# KINO: where else a title can be watched

Luke, 2026-11-06: "yes continue with all of these... forget the illegal sources... set up the technical side for me and
leave spaces for the servers and their series links too". KINO search itself stays as it is: the extra part arrives after
the rows are drawn, and a failure just leaves the row as it was.

Luke, 2026-11-06, later the same day, on the free copies: "remove the rule, but keep that feature as an openable tab which
shows the free copies". And on servers: "remove the rule because it doesnt make any sense in the current spec with how we are
handling tagging and media serving".

## On a KINO row (/media only, not a stream room's lookup)
- **`[ FREE COPIES ▾ ]`** (`[ FREE COPY ▾ ]` for one), shut until pressed. Open, it shows **`[ ▶ FREE ON ARCHIVE ]` /
  `[ ▶ FREE ON YOUTUBE ]`**, marked `PUBLIC DOMAIN` only when Wikidata says the film is, and not also copyrighted. The keys
  keep their space while shut, so opening moves nothing. Plays in the floating player, from the platform's own player. Shutting
  it while a video plays sends the video floating. `NO SERVER HAS THIS.` goes when a copy is there.
- **`WHERE TO WATCH IN <COUNTRY>`**: STREAM, FREE, FREE WITH ADS, RENT OR BUY, by name, from TMDB's watch providers. Credited
  `LISTINGS FROM JUSTWATCH`, which TMDB's terms require, or it can revoke API access. Service names only: no logos (asset rules,
  and plain words read better). Its `[ SEE WHERE ↗ ]` key to TMDB's watch page is gone (Luke, 2026-11-06: "remove the see where
  to watch legally button."). TMDB's docs make that link optional ("You can link to the provided TMDB URL to help support TMDB");
  JustWatch's credit is the condition. The row's `[ ON TMDB ↗ ]` stays.
- The country is Vercel's reading of the address, used to choose the answer and never kept. Nothing here is saved.

## What is offered
Wikidata links a title's TMDB number (P4947 film, P4983 show) to an Archive id (P724) or YouTube id (P1651).
- **Either site:** not a trailer or clip (a role on the link, or under half the running time). Links Wikidata ranks as wrong are skipped.
- **Archive:** a public video item (not dark, not restricted, not a book scan), a film being one video (the Archive's player stops
  after one, so a DVD rip plays a 10-second menu), and not called copyrighted by Wikidata. No evidence of the public domain is
  asked for (Luke, 2026-11-06: "Remove the evidence thing"), so some of these are someone's upload of someone else's film.
- **YouTube:** every upload Wikidata links as the film, if it will play: public, embeddable, not age-locked, not blocked in the
  country (Luke, 2026-11-06: "serve the YouTube videos that are found"). Rights decide only the PUBLIC DOMAIN label. Needs
  `YOUTUBE_API_KEY`; without it nothing from YouTube is offered, because nothing can be checked. One unit of quota per page of rows.

## Limits, said plainly
- Public domain on Wikidata mostly means in the US (about 87% of the Archive-linked ones say so). A viewer elsewhere may be in a country where a film is still under copyright. The site links and never hosts, but it is a real limit.
- Coverage is small: see the numbers below. A big recent film has no free copy, and where to watch is what it gets.
- A show's link is to one video or item: there is no matching of episodes. 51 shows have an Archive link and 628 a YouTube one.
- Wikidata's query service is sometimes busy. Then that page of rows has no free copies until asked again.

## Numbers (Wikidata, 2026-11-06)
- 286,908 films have a TMDB number; 67,155 shows.
- Films with an Archive link: 6,266. A random 200 run through the real rules: 77 passed (38%), so about 2,400 films.
- Films with a YouTube link: 13,657. Public domain and YouTube-linked: 901. Of the 462 not also linked to the Archive, a random 100 run
  through the live route: 66 passed, so about 300 more. In all about 2,700 films, or 1% of the films with a TMDB number.
- With licensed YouTube uploads back (live route, 2026-11-06): of 200 random films from the 13,661 with a YouTube link, 47 were offered,
  8 public domain and 39 licensed, so about 3,200 films on YouTube. Of 12 licensed ones looked at, 5 were named film studios' channels and
  7 general film channels whose rights can't be told from here. The figures above and below are from before this.
- What a viewer meets: 15 ordinary KINO searches (268 titles, 75 of them films): none had a free copy, and 148 had a where-to-watch
  listing in the UK (54 of 75 films, 94 of 193 shows). Of 14 famous old films asked for by name, 9 had one.

## Friends' servers
Already built (SPEC-media-servers.md). Proven end to end 2026-11-06 with three fake https servers: the real hourly update read
their list files, the real rows drew, the real ping route ran, and their player pages loaded in frames, desktop and phone. See
`docs/media-server-fill-in.md` for what to ask each friend.
- No code refuses a host (Luke, 2026-11-06, removed as a waste of code). The rule that a server must hold what it lists is gone
  too (his words at the top), and a `listPath: '*'` server is allowed, though none uses it. Still out: no session adds vidsrc,
  2embed or similar public lookup hosts, or builds film lookups on them.
- **Not fixed, needs a database change:** a list that gives a show BOTH a whole-show line and episode lines is saved as just
  those episodes. The docs say to pick one.

## Code
`app/lib/web/kino-sources.ts` (server), `kino-sources-client.ts` (page; one request per page of rows), `/api/web/kino/sources`,
`app/components/KinoSources.tsx`, `scripts/check-web-kino-one-video.cjs`.
