/*
 * Shared pieces of the search-everywhere checks (`scripts/check-web-search-*.cjs`). Not a check itself:
 * `run-checks.cjs` only runs files named `check-*.cjs`.
 */
const ALLOWED_KEYS = new Set([
  'id', 'platform', 'externalId', 'kind', 'url', 'canonicalUrl', 'title', 'creator', 'description',
  'thumbnailUrl', 'embedUrl', 'licenseUrl', 'durationSeconds', 'tags', 'publishedAt', 'fetchedAt',
  // The platform's own language (Luke, 2026-11-03: language flags on content), a code like 'es' or 'pt-BR'.
  'language',
  // A BOOKS row's catalogue facts (SPEC-book-editions.md, 2026-11-11): how many editions, a free scan, the edition found.
  'book',
]);
const ENGAGEMENT = /like|view|download|rating|star|follow|comment|play_?count|favou?rite|subscri|review|score/i;
const NOW = '2026-10-31T12:00:00.000Z';

function makeAsserts(name) {
  // Failing until the last line says otherwise: an early exit is a failure, never a silent pass.
  process.exitCode = 1;
  let passed = 0;
  const fail = (message) => {
    console.log(`FAIL ${message}`);
    process.exit(1);
  };
  const ok = (condition, message) => {
    if (!condition) fail(message);
    passed += 1;
  };
  const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message} (got ${JSON.stringify(a)})`);
  const done = () => {
    console.log(`ok: ${passed} assertions (${name})`);
    process.exitCode = 0;
  };
  return { ok, same, fail, done };
}

/**
 * An item has only WebItem fields, no engagement field, no markup left in its text, and every address
 * passes `rowAddresses` unchanged (so the page would draw exactly what the provider built).
 */
function checkItem(asserts, rowAddresses, item, where, extra = {}) {
  const { ok } = asserts;
  for (const key of Object.keys(item)) {
    ok(ALLOWED_KEYS.has(key), `${where}: unexpected field "${key}"`);
    ok(!ENGAGEMENT.test(key), `${where}: engagement field "${key}"`);
  }
  ok(item.id === `${item.platform}:${item.externalId}`, `${where}: id is platform:externalId`);
  ok(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(item.externalId), `${where}: external id is safe`);
  ok(typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 300, `${where}: title`);
  for (const key of ['title', 'creator', 'description']) {
    if (item[key] !== undefined) ok(!/<[a-z/!]/i.test(item[key]), `${where}: ${key} still holds markup: ${item[key].slice(0, 80)}`);
  }
  ok(!Number.isNaN(Date.parse(item.publishedAt)) && item.fetchedAt === NOW, `${where}: dates`);
  const addresses = rowAddresses(item, extra);
  ok(addresses.link === item.url, `${where}: page address passes the row check: ${item.url}`);
  if (item.thumbnailUrl !== undefined) ok(addresses.thumb === item.thumbnailUrl, `${where}: thumbnail passes the row check: ${item.thumbnailUrl}`);
  if (item.embedUrl !== undefined) ok(addresses.embed === item.embedUrl, `${where}: player passes the row check: ${item.embedUrl}`);
  if (item.licenseUrl !== undefined) ok(addresses.licence === item.licenseUrl, `${where}: licence passes the row check`);
}

/** A fake fetch answering `body` (JSON unless a string) with `status`, recording every URL asked for. */
function fakeFetch(body, status = 200) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, urls };
}

module.exports = { NOW, makeAsserts, checkItem, fakeFetch };
