// A local dev server with every data switch on mock but REAL (Supabase) sign-in pointed at an address nothing answers,
// so a visitor is signed out and the lost-account window and its line can show (mock sign-in hides them). Nothing
// reaches the live project. node scripts/dev-mock-signed-out.cjs [port]   (FIRSTVISIT, after FORUMFIX's launcher)
const { spawn } = require('node:child_process');
const port = process.argv[2] || '3352';
const switches = 'AQUARIUM BEATBOX BOOKS COMMS DOCS FORUM GAMES HISTORY LETTERS LORE MEDIA MUSIC NOTIFICATIONS PROFILE_CHARACTER PROFILE RECOMMENDATIONS WATCH WEB WINDOWS'.split(' ');
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'nothing-answers', NEXT_PUBLIC_AUTH_BACKEND: 'supabase' };
for (const s of switches) env[`NEXT_PUBLIC_${s}_DATA_SOURCE`] = 'mock';
const child = spawn('npx', ['next', 'dev', '-p', port], { env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
