DEBASER.SITE
============

An archive of comic-book lore and concept art, run like a Web 1.0 desktop. A message board, an
account directory, direct messages, a music shelf, a set of hand-drawn concept sheets and a set of
lore pages written live by whoever is looking at one share a single window frame, one palette and
one set of stores.

Every drawing is hand-drawn on a Kamvas tablet and filed by hand: nothing here generates artwork,
and no character, icon or cursor is drawn in CSS or in SVG. AGENTS.md holds the look to that rule
and to the rest of the aesthetic; `assets/README.txt` says where each kind of drawing goes.

What is where
-------------
    app/                  the site: one folder per route, plus the chrome, the stores and the rules
      page.tsx            the landing map, and the project it lists
      forum/              the board: posts, replies, tags, pins and moderation
      users/ comms/       the account directory, and the conversations between accounts
      account/            signing in, and the public-profile customiser
      profile/[userId]/   one account's public page, with the comment wire that runs over it
      concepts/           the hand-drawn sheets, each in a window of its own with its own thread
      music/              the archive as a file browser: folders, files, tags, and the player
      lore/[slug]/        lore pages, edited together in real time
      notes/ links/       how the archive is built, and everywhere else worth going
      api/                the routes a browser posts files to on the mock stores
      lib/                every store and every rule, one folder per subject
      components/         the chrome, the windows and the panels
    assets/               every hand-drawn file, streamed by app/assets/[...path]/route.ts
    supabase/             schema.sql (the whole database, safe to re-run) plus the newer sections
                          as migrations, and README.md - the order to run everything in
    Temp/                 local scratch: the check scripts, their logs and the commit messages
                          (gitignored, and never needed to run or to build the site)

Running it
----------
    npm install
    npm run dev           # http://localhost:3000

The site runs with no backend at all. Every store falls back to a localStorage mock when the
environment says nothing, so the board, the profiles, the conversations, the shelf and the lore
pages all work on a fresh clone - and each part can be moved onto Supabase on its own.

The switches
------------
Copy `.env.example` to `.env.local`, then fill in the project's url and publishable key:

    NEXT_PUBLIC_SUPABASE_URL=...              the project, and the key the browser reads with
    NEXT_PUBLIC_SUPABASE_ANON_KEY=...
    NEXT_PUBLIC_AUTH_BACKEND=supabase         accounts
    NEXT_PUBLIC_FORUM_DATA_SOURCE=supabase    the board
    NEXT_PUBLIC_PROFILE_DATA_SOURCE=supabase  profiles, pictures, tags
    NEXT_PUBLIC_COMMS_DATA_SOURCE=supabase    direct messages
    NEXT_PUBLIC_MUSIC_DATA_SOURCE=supabase    the shelf's files and folders

`.env.production` is committed with the same names, because every one of them is a `NEXT_PUBLIC_*`
value that reaches the browser in the bundle anyway: Row Level Security in `supabase/schema.sql` is
what protects the data. `supabase/README.md` is the order to run, the house account to make, the
Google sign-in seam to open - and what each part of the site does until its script has been run.

Checks
------
    npm run lint          # eslint
    npm run typecheck     # tsc --noEmit
    npm run build         # next build, which typechecks and prerenders every route
    npm run verify        # the three above, in that order

    node Temp/run-checks.cjs

The last one runs the scratch checks: the assertions behind each feature, from the pin durations to
the wire's rows to the Yjs handshake between two editors. Each compiles the modules it needs with
`npx tsc` first, from the command written in its own header comment, so that one command is the
whole run. The live probes beside them need a Supabase project and credentials, and are run by hand
against the deployed one.

One pass is not part of that suite, because it needs a capture of the built site:

    node Temp/qa-audit.cjs

It reads the HTML `next start` serves - one file per route, the same bytes a visitor's browser gets
before any JavaScript runs, which is also what a screen reader sees - and reports what a person
meets: fields with no name, controls too small for a thumb, text too small to read, colour pairs
below the contrast floor. It also lists the handful of things no script can answer and somebody
should walk through by hand. `Temp/check-ux.cjs` is the part of that pass the ordinary suite can
hold, so a regression is caught without a server.

Deploying
---------
Vercel, straight from this repository. `next build` is what runs there, `.env.production` is what
points it at Supabase, and nothing else has to be configured in a dashboard - except the schema,
which is run once in the Supabase SQL editor (step 1 of `supabase/README.md`).

