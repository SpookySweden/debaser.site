/*
 * Moves keys Luke pasted into a paste-keys-here.txt into the file that uses them, then empties the paste file
 * (SPEC-self-hosting.md, Stage 3). It never prints a value: only which names were filled and their length.
 *
 *   node merge-pasted-keys.cjs supabase   G:\DEBASER-HOST\supabase\paste-keys-here.txt -> supabase\.env
 *                                         (GOOGLE_SECRET, SMTP_PASS; a filled GOOGLE_SECRET turns GOOGLE_ENABLED on)
 *   node merge-pasted-keys.cjs site       G:\DEBASER-HOST\site-keys-paste.txt -> G:\DEBASER-HOST\site.env
 *                                         (the outside-API keys the site's server uses)
 */
const { readFileSync, writeFileSync } = require('node:fs');

const TARGETS = {
  supabase: { paste: 'G:\\DEBASER-HOST\\supabase\\paste-keys-here.txt', file: 'G:\\DEBASER-HOST\\supabase\\.env', keys: ['GOOGLE_SECRET', 'SMTP_PASS'] },
  site: {
    paste: 'G:\\DEBASER-HOST\\site-keys-paste.txt',
    file: 'G:\\DEBASER-HOST\\site.env', // self-update.cjs copies it into each build as .env.production.local
    keys: ['TMDB_READ_TOKEN', 'YOUTUBE_API_KEY', 'ANTHROPIC_API_KEY', 'GIPHY_API_KEY', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'],
  },
};
const target = TARGETS[process.argv[2] || 'supabase'];
if (!target) throw new Error(`unknown target; use one of: ${Object.keys(TARGETS).join(', ')}`);

const pasted = {};
for (const line of readFileSync(target.paste, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && target.keys.includes(m[1]) && m[2] !== '') pasted[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
let env = readFileSync(target.file, 'utf8');
const setKey = (k, v) => {
  const re = new RegExp(`^${k}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, () => `${k}=${v}`) : `${env.replace(/\n?$/, '\n')}${k}=${v}\n`;
};
for (const [k, v] of Object.entries(pasted)) setKey(k, v);
if (process.argv[2] !== 'site' && pasted.GOOGLE_SECRET) setKey('GOOGLE_ENABLED', 'true');
writeFileSync(target.file, env);
const before = readFileSync(target.paste, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]);
writeFileSync(target.paste, before.map((k) => `${k}=`).join('\n') + '\n');

for (const k of target.keys) {
  const now = new RegExp(`^${k}=(.+)$`, 'm').exec(env);
  console.log(`${k}: ${pasted[k] ? 'filled from the paste file' : now ? 'already set' : 'not set'}${now ? ` (${now[1].length} characters)` : ''}`);
}
if (process.argv[2] !== 'site') console.log(`GOOGLE_ENABLED: ${/^GOOGLE_ENABLED=true$/m.test(env)}`);
