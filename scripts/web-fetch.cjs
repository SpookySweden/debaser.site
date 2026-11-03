/*
 * Runs the archive's hourly fetch now, instead of waiting for the next minute 17 (run from the root):
 *   npm run web:fetch
 *
 * Luke's standing OK (2026-11-03): a session may run this when it needs fresh archive data to check its work. It
 * saves items into the live stream exactly as the hourly run does, so it is a database write and goes through
 * `npm run db -- --write`, whose guard prints the statement first.
 *
 * Why it exists: a change to what the fetch saves can only be seen after a fetch has run, and the schedule is once
 * an hour. On 2026-11-03 a session pushed at 10:28 UTC and polled the database every two minutes until the 11:17
 * run.
 *
 * How: pg_cron's job `web-ingest` (supabase/migrations/20261031200000_web_ingest_cron.sql) is one
 * `select net.http_post(...)` that reads the ingest lock out of Vault inside the database. This runs that job's own
 * command, read from cron.job so it cannot drift from the schedule, in a `do` block: the lock never leaves the
 * database, and nothing here reads or prints it. pg_net sends the request in the background, so this then waits
 * for the route's answer in net._http_response and prints what each source saved (the answer is counts and ids).
 *
 * Exit codes: 0 the fetch answered 200, 1 it answered an error or did not answer in time, 2 the database could not
 * be asked, 3 the hourly run is due within minutes (wait for that one instead).
 */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const DB = join(__dirname, 'db.cjs');
/** The route may take 60 seconds (its maxDuration), and pg_net gives it 60; a little over that for the queue. */
const ANSWER_WITHIN_MS = 100_000;
const EVERY_MS = 4000;

function finish(code, message) {
  console.log(message);
  process.exit(code);
}

/** One statement through scripts/db.cjs; the rows of its JSON answer. */
function db(flag, sql) {
  let out;
  try {
    out = execFileSync(process.execPath, [DB, flag, sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim().split('\n').slice(-3).join(' ');
    finish(2, `COULD NOT ASK THE DATABASE: ${detail || error.message}`);
  }
  const at = out.indexOf('{');
  if (at === -1) return [];
  try {
    return JSON.parse(out.slice(at)).rows ?? [];
  } catch {
    return [];
  }
}

function report(row) {
  let body = null;
  try {
    body = JSON.parse(row.content);
  } catch {
    // not JSON: printed raw below
  }
  console.log(`the fetch answered HTTP ${row.status_code}`);
  if (!body) {
    console.log(String(row.content ?? row.error_msg ?? '').slice(0, 300));
    return;
  }
  for (const source of body.results ?? []) {
    const outcome = source.error ? `ERROR ${source.error}` : `saved ${source.saved}, skipped ${source.skipped}`;
    console.log(`  ${source.label}: ${outcome}`);
  }
  if (body.media) {
    for (const server of body.media.servers ?? []) console.log(`  media server ${JSON.stringify(server).slice(0, 140)}`);
    console.log(`  TMDB details filled: ${body.media.details}${body.media.detailsError ? ` (${body.media.detailsError})` : ''}`);
  }
  for (const [key, value] of Object.entries(body)) {
    if (!['checked', 'results', 'media'].includes(key)) console.log(`  ${key}: ${JSON.stringify(value).slice(0, 200)}`);
  }
}

async function main() {
  const minute = new Date().getUTCMinutes();
  if (minute >= 15 && minute < 20) {
    finish(3, `The hourly fetch runs at minute 17 and it is minute ${minute}: wait for that run rather than start a second one beside it.`);
  }

  const before = Number(db('--read-only', 'select coalesce(max(id), 0) as last from net._http_response;')[0]?.last ?? 0);
  const jobs = db('--read-only', "select count(*)::int as n from cron.job where jobname = 'web-ingest' and active;");
  if (jobs[0]?.n !== 1) finish(2, 'NO ACTIVE web-ingest JOB in cron.job, so there is no fetch to run.');

  console.log('asking the database to run the hourly fetch now (the web-ingest job\'s own command)');
  db('--write', "do $$ begin execute (select command from cron.job where jobname = 'web-ingest'); end $$;");

  const deadline = Date.now() + ANSWER_WITHIN_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
    const rows = db(
      '--read-only',
      `select id, status_code, timed_out, error_msg, content from net._http_response where id > ${before} order by id limit 1;`,
    );
    if (rows.length > 0) {
      const row = rows[0];
      if (row.timed_out || row.status_code === null) finish(1, `THE FETCH DID NOT ANSWER: ${row.error_msg ?? 'timed out'}`);
      report(row);
      finish(row.status_code === 200 ? 0 : 1, row.status_code === 200 ? 'FETCHED: the stream has whatever it saved now.' : 'THE FETCH FAILED: see its answer above.');
    }
  }
  finish(1, `NO ANSWER after ${ANSWER_WITHIN_MS / 1000}s: the request may still be queued. Look in net._http_response for an id above ${before}.`);
}

main();
