/*
 * WEB paste-a-link and the Vimeo lookup, offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/link.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-search-link --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - each platform's address forms are recognised, with tracking parameters; lookalike hosts, other paths, ports,
 *   credentials, javascript: and bad ids are not
 * - a PeerTube link counts only on an indexed instance; its short id decodes to the real uuid
 * - resolving never fetches the pasted address: only the platform's API, at an address built from the id
 * - a PeerTube answer about a copy on another instance is refused
 * - the Vimeo oEmbed fixture (real) becomes an item the page draws: player.vimeo.com, thumbnail rebuilt without its query,
 *   and oEmbed's own html is never used
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { NOW, makeAsserts, checkItem, fakeFetch } = require('./web-search-check-kit.cjs');

const OUT = join(__dirname, '..', 'Temp', 'out-web-search-link', 'lib', 'web');
const { parseLink, resolveLink, shortUuidToUuid } = require(join(OUT, 'search', 'link.js'));
const vimeo = require(join(OUT, 'search', 'providers', 'vimeo.js'));
const { looksLikeLink } = require(join(OUT, 'link-shape.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const asserts = makeAsserts('WEB paste-a-link');
const { ok, same } = asserts;
const HOSTS = new Set(['video.blender.org', 'fedi.video']);
const UUID = 'b29290cc-dc51-4a12-bcb2-2aa5fece7605';

(async () => {
  /* ---------------------------------------------------------------- recognising */
  same(shortUuidToUuid('o3XdtSYTnv2LYxRsf8Mndz'), UUID, 'a real PeerTube short id decodes to its uuid (live-checked pair)');
  same(shortUuidToUuid('0OIl'), null, 'not base-58');
  const good = [
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30s&si=abc', { platform: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['https://youtu.be/aqz-KE-bpKQ?si=x', { platform: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['youtu.be/aqz-KE-bpKQ', { platform: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['https://m.youtube.com/shorts/aqz-KE-bpKQ', { platform: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ', { platform: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['http://www.youtube.com/live/aqz-KE-bpKQ', { platform: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['https://vimeo.com/76979871', { platform: 'vimeo', id: '76979871' }],
    ['https://player.vimeo.com/video/76979871', { platform: 'vimeo', id: '76979871' }],
    ['https://archive.org/details/Sintel', { platform: 'internet_archive', id: 'Sintel' }],
    ['https://archive.org/details/Sintel/Sintel.mp4', { platform: 'internet_archive', id: 'Sintel' }],
    ['archive.org/embed/Sintel', { platform: 'internet_archive', id: 'Sintel' }],
    [`https://video.blender.org/videos/watch/${UUID}`, { platform: 'peertube', host: 'video.blender.org', uuid: UUID }],
    ['https://video.blender.org/w/o3XdtSYTnv2LYxRsf8Mndz', { platform: 'peertube', host: 'video.blender.org', uuid: UUID }],
    [`https://fedi.video/videos/embed/${UUID}`, { platform: 'peertube', host: 'fedi.video', uuid: UUID }],
    ['https://commons.wikimedia.org/wiki/File:Night_of_the_Living_Dead_(1968).webm', { platform: 'wikimedia_commons', fileName: 'Night_of_the_Living_Dead_(1968).webm' }],
    ['https://commons.wikimedia.org/wiki/File:Caf%C3%A9.jpg', { platform: 'wikimedia_commons', fileName: 'Café.jpg' }],
    ['https://commons.wikimedia.org/w/index.php?curid=36110112', { platform: 'wikimedia_commons', pageId: '36110112' }],
  ];
  for (const [raw, want] of good) same(parseLink(raw, HOSTS), want, `recognised: ${raw}`);
  const bad = [
    'night of the living dead',
    'javascript:alert(1)',
    'https://evilyoutube.com/watch?v=aqz-KE-bpKQ',
    'https://youtube.com.evil.org/watch?v=aqz-KE-bpKQ',
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ<script>',
    'https://www.youtube.com/watch?v=-qz-KE-bpKQ',
    'https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg',
    'https://youtu.be:8443/aqz-KE-bpKQ',
    'https://user:pass@youtu.be/aqz-KE-bpKQ',
    'https://vimeo.com/76979871/abcdef1234',
    'https://player.vimeo.com/video/76979871?h=abcdef',
    'https://vimeo.com/channels/staff',
    'https://archive.org/details/-bad',
    'https://archive.org/search?query=x',
    `https://unindexed.example.org/videos/watch/${UUID}`,
    'https://video.blender.org/videos/watch/not-a-uuid',
    'https://video.blender.org/w/0OIl0OIl0OIl0OIl0OIl',
    'https://commons.wikimedia.org/wiki/Category:Films',
    'https://commons.wikimedia.org/wiki/File:%E0%A4%A',
    'ftp://archive.org/details/Sintel',
    'https://127.0.0.1/videos/watch/' + UUID,
    'x'.repeat(700),
  ];
  for (const raw of bad) same(parseLink(raw, HOSTS), null, `not recognised: ${raw.slice(0, 80)}`);
  ok(looksLikeLink('https://x.org/a') && !looksLikeLink('two words') && !looksLikeLink('night'), 'words are words, addresses are addresses');

  /* ---------------------------------------------------------------- resolving */
  const vimeoBody = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'link-vimeo-oembed.json'), 'utf8'));
  const ytBody = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'link-youtube-oembed.json'), 'utf8'));
  const cases = [
    ['https://vimeo.com/76979871?utm=evil', vimeoBody, 'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871'],
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=evil', ytBody, 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daqz-KE-bpKQ&format=json'],
  ];
  for (const [raw, body, asked] of cases) {
    const fake = fakeFetch(body);
    const item = await resolveLink(parseLink(raw, HOSTS), { fetch: fake.fetch, now: () => new Date(NOW) });
    same(fake.urls, [asked], `only the platform API is asked, at an address built from the id (${raw})`);
    ok(!fake.urls.some((url) => url.includes('evil')), 'nothing of the pasted address but the id goes out');
    checkItem(asserts, rowAddresses, item, item.id);
  }
  const vimeoItem = await vimeo.vimeoById('76979871', { fetch: fakeFetch(vimeoBody).fetch, now: () => new Date(NOW) });
  same(vimeoItem.embedUrl, 'https://player.vimeo.com/video/76979871', 'Vimeo plays in its own player');
  same(vimeoItem.thumbnailUrl, 'https://i.vimeocdn.com/video/452001751-8216e0571c251a09d7a8387550942d89f7f86f6398f8ed886e639b0dd50d3c90-d_295x166', 'thumbnail rebuilt without its query');
  same([vimeoItem.publishedAt, vimeoItem.durationSeconds], ['2013-10-15T14:08:29.000Z', 62], 'upload date and length');
  ok(!JSON.stringify(vimeoItem).includes('iframe') && !JSON.stringify(vimeoItem).includes('app_id'), "oEmbed's html is never used");
  same(await vimeo.vimeoById('76979871', { fetch: fakeFetch({ ...vimeoBody, video_id: 1 }).fetch }), null, 'an answer about another video is null');
  same(await vimeo.vimeoById('76979871', { fetch: fakeFetch('Forbidden', 403).fetch }), null, 'a private video is null');
  same((await vimeo.vimeoById('76979871', { fetch: fakeFetch({ ...vimeoBody, thumbnail_url: 'https://evil.example.org/video/1-0123456789abcdef-d_1x1' }).fetch, now: () => new Date(NOW) })).thumbnailUrl, undefined, 'a thumbnail off Vimeo is dropped');

  const sepiaCopy = { total: 1, data: [{ uuid: UUID, privacy: { id: 1 }, nsfw: false, isLive: false, account: { host: 'fedi.video' }, channel: { host: 'fedi.video' }, url: `https://fedi.video/videos/watch/${UUID}`, publishedAt: '2026-01-01T00:00:00Z', name: 'x' }] };
  const asked = fakeFetch(sepiaCopy);
  same(await resolveLink(parseLink(`https://video.blender.org/videos/watch/${UUID}`, HOSTS), { fetch: asked.fetch, peertubeHosts: HOSTS, now: () => new Date(NOW) }), null, 'a PeerTube copy on another instance than the link named is refused');
  ok(asked.urls.every((url) => url.startsWith('https://sepiasearch.org/')), 'PeerTube links ask Sepia Search, never the instance');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
