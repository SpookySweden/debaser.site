// Stage 2 local test (SPEC-self-hosting.md): the PC's copy of the site in dev mode, pointed at the PC's own Supabase.
// Dev mode doesn't read .env.production, so its NEXT_PUBLIC_* switches are passed in here, with the Supabase address and
// public anon key replaced by the PC's (127.0.0.1:8000). Nothing points at the cloud project. Prints no key.
// node run-local-site.cjs <port>
const { spawn } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');

const SITE = 'G:\\DEBASER-HOST\\site';
const port = process.argv[2] || '3317';
if (existsSync(`${SITE}\\.env.local`)) throw new Error('.env.local in the PC copy would point dev mode elsewhere; stopping');

const env = { ...process.env };
for (const line of readFileSync(`${SITE}\\.env.production`, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && m[1].startsWith('NEXT_PUBLIC_')) env[m[1]] = m[2];
}
const supa = readFileSync('G:\\DEBASER-HOST\\supabase\\.env', 'utf8');
env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:8000';
env.NEXT_PUBLIC_SUPABASE_ANON_KEY = /^ANON_KEY=(.*)$/m.exec(supa)[1].trim();
env.NEXT_TELEMETRY_DISABLED = '1';

console.log(`site dev server on http://localhost:${port}, Supabase at ${env.NEXT_PUBLIC_SUPABASE_URL}; switches: ` +
  Object.keys(env).filter((k) => /^NEXT_PUBLIC_.*(DATA_SOURCE|BACKEND)$/.test(k)).map((k) => `${k.replace('NEXT_PUBLIC_', '')}=${env[k]}`).join(' '));
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', port], { cwd: SITE, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
