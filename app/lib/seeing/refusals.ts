/**
 * A refused page, said plainly (IMPROVE, 2026-11-23): what the reason means, and what may still be tried. Pure. The reasons are the server's
 * own words (`safe-fetch.ts`, `server/open.ts`, `server-engine.ts`); one this list doesn't know gets the general answer, never a made-up one.
 */
export type Try = 'again' | 'old' | 'own' | 'source';
export type RefusalHelp = { means: string; tries: readonly Try[] };

const HELP: readonly [RegExp, RefusalHelp][] = [
  [/^NO SUCH SITE$/, { means: 'NO COMPUTER ANSWERS TO THAT NAME. CHECK THE SPELLING; A SITE THAT HAS GONE MAY HAVE AN OLD COPY.', tries: ['old'] }],
  [/^THE SOURCE (TOOK TOO LONG|DID NOT ANSWER|STOPPED PART WAY)$/, { means: 'THE SITE WAS SLOW OR DOWN WHEN THE MACHINE ASKED. IT MAY ANSWER A SECOND TIME.', tries: ['again', 'old', 'own'] }],
  [/^TOO LARGE$/, { means: 'THE PAGE IS BIGGER THAN THE MACHINE CARRIES. YOUR OWN BROWSER CAN STILL OPEN IT.', tries: ['own', 'source'] }],
  [/^TOO MANY FILES$/, { means: 'THE PAGE ASKED FOR MORE FILES THAN THE MACHINE FETCHES FOR ONE PAGE.', tries: ['again', 'own'] }],
  [/^NOT A PUBLIC ADDRESS$/, { means: 'IT POINTS INSIDE A HOUSE OR A PRIVATE NETWORK. THE MACHINE NEVER LOOKS THERE.', tries: [] }],
  [/^KNOWN FOR MALWARE OR PHISHING$/, { means: 'A BLOCKLIST NAMES THIS SITE AS HARMFUL. THE MACHINE WILL NOT OPEN IT.', tries: [] }],
  [/^IT LEADS (NOWHERE|ROUND AND ROUND)$/, { means: 'THE SITE SENDS VISITORS ON SOMEWHERE ELSE, AND THAT WAY DOES NOT END. IT MAY WANT A SIGN-IN OR A COOKIE.', tries: ['own', 'source'] }],
  [/^NOT WHAT IT SAYS IT IS$/, { means: 'THE SITE ANSWERED WITH SOMETHING THAT IS NOT A PAGE.', tries: ['source'] }],
  [/^A BOOK: READ OPENS THOSE$/, { means: 'IT IS A PDF OR AN EPUB. READ, ON THE BAR, OPENS BOOKS.', tries: ['source'] }],
  [/^TOO MANY PAGES AT ONCE/, { means: 'THE MACHINE OPENS ONLY SO MANY PAGES A MINUTE. WAIT, THEN TRY AGAIN.', tries: ['again'] }],
  [/^THE MACHINE (IS OFF|HAS NO EYE YET)$/, { means: "THE SERVER'S EYE IS SHUT. YOUR OWN BROWSER CAN STILL SHOW IT.", tries: ['own', 'source'] }],
  [/^LOG IN TO OPEN PAGES$/, { means: 'PAGES OPEN FOR PEOPLE WITH AN ACCOUNT.', tries: [] }],
];

const ANYTHING_ELSE: RefusalHelp = { means: 'THE PAGE DID NOT COME. IT MAY COME A SECOND TIME, OR AS AN OLD COPY.', tries: ['again', 'old', 'own'] };

export function refusalHelp(reason: string): RefusalHelp {
  for (const [pattern, help] of HELP) if (pattern.test(reason)) return help;
  return ANYTHING_ELSE;
}
