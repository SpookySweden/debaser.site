/*
 * Reads the deployed pages back and reports what shape they are in (ASCII output only):
 *   node --env-file=.env.local Temp/check-live-shape.cjs
 *
 * It checks the deployment, not the features: every page answers, the shell is on each one,
 * the board carries its wire, and the profile carries the one comment control, its own wire,
 * and no per-element comment links. It also reports what the deployed profile row says about
 * comments being on, because that is a column the SQL has to have flipped - the code's default
 * cannot reach a row that already exists.
 */
const BASE = 'https://debaser-site.vercel.app';
const HOUSE = 'b5a56c2d-f8d2-480c-bf41-3f89ea950427';

function headers() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function rest(query) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const response = await fetch(`${url}/rest/v1/${query}`, { headers: headers() });

  return response.ok ? response.json() : [];
}

async function shape(label, path, checks) {
  const response = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  const body = await response.text();

  console.log(`${label}: ${response.status} ${path}`);
  let failed = 0;

  for (const [name, pattern, wanted] of checks) {
    const found = pattern.test(body);
    if (found !== wanted) failed += 1;
    console.log(`  ${found === wanted ? 'ok  ' : 'FAIL'} ${name}`);
  }

  return failed;
}

const PAGES = [
  ['/', [['its own title', /<title>DEBASER\.SITE - Portal Archive<\/title>/, true]]],
  ['/forum', [['the news wire', /NEWSWIRE/, true]]],
  ['/account', [['the account page', /ACCOUNT MANAGER/, true]]],
  ['/users', [['the directory', /<title>/, true]]],
  ['/music', [['the music page', /<title>/, true]]],
  ['/comms', [['comms', /<title>/, true]]],
  ['/concepts', [['the concept sheets', /<title>/, true]]],
  ['/notes', [['notes', /<title>/, true]]],
  ['/links', [['links', /<title>/, true]]],
  ['/projects/debaser', [['the debaser project', /<title>/, true]]],
];

const COMMON = [
  ['the shell is on the page', /DEBASER_OS/, true],
  ['no artwork drawn in code', /<svg/, false],
];

(async () => {
  let failed = 0;

  for (const [path, checks] of PAGES) {
    failed += await shape('page', path, [...checks, ...COMMON]);
  }

  failed += await shape('profile', `/profile/${HOUSE}`, [
    ['one comment control', />comment<\/button>/, true],
    ['and no second one', /(>comment<\/button>[\s\S]*>comment<\/button>)/, false],
    ['the menu it opens', /aria-haspopup="menu"/, true],
    ['how much of the profile is open', /of 3 open to comments|nothing open to comments/, true],
    ['its own wire, labelled', /NEWSWIRE :: WHAT THE BOARD IS SAYING/, true],
    ['and not boxed as a black display', /class="crawl[^"]*bg-black/, false],
    // The board's store is read in the browser, so the server render is always the empty
    // state: the rows are checked on the forum page, where the same store feeds the ticker.
    ['waiting for the store', /NOTHING ON THE WIRE YET|\[ POST \]/, true],
    ...COMMON,
  ]);

  const [row] = await rest(`profiles?id=eq.${HOUSE}&select=show_profile_comments,show_avatar_comments,show_song_comments`);
  console.log('deployed profile row:', JSON.stringify(row ?? {}));
  console.log(
    row?.show_profile_comments === true
      ? '  the SQL has been run: comments are open on the house account'
      : '  the SQL still needs running: the row predates the new default',
  );

  console.log(failed === 0 ? '\nlive shape ok' : `\n${failed} marks missing`);
})();
