/*
 * The live board's own tag filter: does every tag the chooser offers actually bring a post?
 *   npx tsc app/lib/forum/tags.ts app/lib/forum/tag-vocabulary.ts app/lib/forum/board-query.ts app/lib/forum/anchors.ts app/lib/forum/site-author.ts app/lib/forum/format.ts app/lib/forum/media.ts app/lib/forum/post-layout.ts app/lib/forum/paging.ts app/lib/forum/comment-tree.ts app/lib/concepts/sheets.ts --outDir Temp/board-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/lib/forum/repository.ts app/lib/forum/supabase-repository.ts --outDir Temp/supabase-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node --env-file=.env.local Temp/check-live-tag-filter.cjs
 *
 * Live, and left out of run-checks.cjs: it reads the *deployed* board through the app's own
 * repository, then asks the app's own query the same question the forum page asks - for every tag
 * the chooser offers, which posts does the filter bring?
 *
 * The chooser's number is a promise (see app/lib/forum/tag-vocabulary.ts, which counts a tag on a
 * post and on its replies), and the filter has to keep it. Before replies were read, a MECHANICS tag
 * typed into a reply made the chip read `MECHANICS (1)` and the board show nothing at all; this
 * check exists to catch that on real rows, which is where it was first seen.
 */
const assert = require('node:assert/strict');

const { buildTagVocabulary } = require('./board-out/forum/tag-vocabulary.js');
const { selectBoardThreads, threadTagMatches } = require('./board-out/forum/board-query.js');
const { getForumRepository } = require('./supabase-out/forum/repository.js');

const query = (tagKeys) => ({
  query: '',
  sourceFilter: 'all',
  tagKeys,
  tagMatchMode: 'any',
  sortMode: 'newest',
});

(async () => {
  const repository = getForumRepository();
  assert.equal(repository.source, 'supabase', 'this is a live check: it needs the board\'s own keys');

  const threads = await repository.listThreads();
  const replies = threads.reduce((total, thread) => total + thread.comments.length, 0);
  const offered = buildTagVocabulary(threads).filter((option) => option.count > 0);

  console.log(`live board : ${threads.length} post(s), ${replies} reply/replies, ${offered.length} tag(s) in use`);
  console.log(`reading    : ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'no url in the environment'}`);

  let broken = 0;

  for (const option of offered) {
    const brought = selectBoardThreads(threads, query([option.key]));
    const byReply = brought.filter((thread) =>
      threadTagMatches(thread, [option.key]).some((match) => match.comment !== undefined),
    ).length;

    if (brought.length === 0) broken += 1;

    console.log(
      `  ${brought.length === 0 ? 'FAIL' : 'ok  '} ${option.label.padEnd(18)} chip (${option.count}) -> ` +
        `${brought.length} post(s)${byReply === 0 ? '' : `, ${byReply} by a reply`}`,
    );
  }

  console.log(
    broken === 0
      ? 'every offered tag brings a post'
      : `${broken} tag(s) promise a post the filter cannot show`,
  );

  process.exitCode = broken === 0 ? 0 : 1;
})().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
