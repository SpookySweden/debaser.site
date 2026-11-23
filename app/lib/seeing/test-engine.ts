/**
 * The built-in test page (SPEC-seeing-machine.md, Phase 1): two pages carried in the code, so the machine can be tried with nothing
 * fetched. They are dressed as pages from outside are (their own colours, their own styles), so STANDARD has something to leave alone.
 */
import { isBuiltIn } from './address';
import type { SeeAnswer, SeenDocument, SeeingEngine } from './engine';

const STYLE = `<style>
body{margin:0;background:cornsilk;color:black;font-size:18px;line-height:1.5}
header{background:darkslateblue;color:white;padding:16px 24px}
main{padding:8px 24px 48px;max-width:720px}
a{color:mediumblue} .box{border:3px double maroon;padding:8px 16px;background:white}
table{border-collapse:collapse} td,th{border:1px solid black;padding:4px 10px;text-align:left}
</style>`;

const FIRST = `<h1>The test page</h1>
<p>This page is built into the machine. Nothing was fetched to show it, and nothing on it can reach anything outside the frame it sits in.</p>
<h2 id="links">Links</h2>
<ul>
<li><a href="see:test/2">The second test page</a>, so there is somewhere to come back from.</li>
<li><a href="#end">The end of this page</a>, further down.</li>
<li><a href="https://example.com/">An address outside</a>. It opens when the machine has an eye for you, and says why when it has not.</li>
</ul>
<h2>A table</h2>
<table><tr><th>Lens</th><th>What it does</th></tr><tr><td>STANDARD</td><td>Leaves a page alone.</td></tr><tr><td>READER</td><td>Keeps the words, on your theme's paper.</td></tr><tr><td>WATCHERS</td><td>Says who was on the page.</td></tr></table>
<h2>A quotation</h2>
<blockquote><p>Every page is read by somebody. Some pages read back.</p></blockquote>
<p class="see-quiet">A line set small: the caption ink.</p>
<h2>Filler</h2>
${'<p>Words to scroll past. A page has to be long before its end is out of sight, and this one is long on purpose. Change the theme while READER is on and these words are dressed again where they stand, without the page starting over.</p>'.repeat(9)}
<h2 id="end">The end</h2>
<p><a href="#links">Back to the links</a>.</p>`;

const SECOND = `<h1>The second test page</h1>
<p>You came here by a link. The ◄ key goes back to <a href="see:test">the first page</a>, and ► comes here again.</p>`;

const standing = (body: string): string => `${STYLE}<header>TEST PAGE, BUILT IN</header><main>${body}</main>`;

/** Reserved names (RFC 2606): nobody's, and not looked up. */
const PRETEND = [
  { company: 'A pretend advertiser', host: 'ads.example', refused: true },
  { company: 'A pretend counter', host: 'counter.example', refused: true },
  { company: 'A pretend font service', host: 'fonts.example', refused: false },
];

const PAGES: Record<string, { title: string; body: string; watchers: SeenDocument['watchers'] }> = {
  'see:test': { title: 'The test page', body: FIRST, watchers: PRETEND },
  'see:test/2': { title: 'The second test page', body: SECOND, watchers: [] },
};

export const TEST_ADDRESS = 'see:test';

export const testEngine: SeeingEngine = {
  name: 'BUILT IN',
  takes: isBuiltIn,
  async open(address, onStep): Promise<SeeAnswer> {
    const page = PAGES[address];
    if (page === undefined) return { ok: false, reason: 'NO BUILT-IN PAGE HAS THAT ADDRESS' };
    onStep('ACQUIRING SOURCE');
    return {
      ok: true,
      document: {
        address,
        title: page.title,
        eye: 'BUILT IN',
        html: standing(page.body),
        reading: page.body,
        watchers: page.watchers,
        files: 0,
        refused: 0,
        status: null,
        signIn: false,
        refresh: null,
        assets: null,
        scripts: false,
      },
    };
  },
};

