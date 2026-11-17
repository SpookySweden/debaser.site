// A local dev server cut off from the live site, for LIVE (SPEC-live-streams.md): every data switch on mock, mock sign-in, and the
// Supabase address and key EMPTY (an empty value survives `spawn`'s env, unlike PowerShell's `$env:X = ''`).
// node scripts/dev-mock-live.cjs [port]      (the pattern of Temp/browse/dev-mock-rooms.cjs). Twitch and YouTube are the real ones.
const { spawn } = require('node:child_process');
const port = process.argv[2] || '3317';
const switches = 'AQUARIUM BEATBOX BOOKS COMMS DOCS FORUM GAMES HISTORY LETTERS LORE MEDIA MUSIC NOTIFICATIONS PROFILE_CHARACTER PROFILE RECOMMENDATIONS WATCH WEB WINDOWS'.split(' ');
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', NEXT_PUBLIC_AUTH_BACKEND: 'mock' };
for (const s of switches) env[`NEXT_PUBLIC_${s}_DATA_SOURCE`] = 'mock';
const child = spawn('npx', ['next', 'dev', '-p', port], { env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
