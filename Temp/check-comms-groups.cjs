/*
 * Scratch check for the comms store on both database shapes (run from the root):
 *   npx tsc app/lib/comms/threads.ts app/lib/comms/supabase-comms-repository.ts app/lib/supabase/client.ts --outDir Temp/comms-groups-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-comms-groups.cjs
 *
 * Part 1 is the project as it is deployed today: `comms_threads` is still the pair
 * table, with no `kind`, `name`, `created_by` and no `comms_members`. The read has to
 * fall back, direct messages have to work, and a group has to say what is missing.
 *
 * Part 2 is the same project after the group script: the members embed is read, a group
 * is created with its membership rows, and a write reaches the listeners at once.
 *
 * The Supabase client is faked at the module boundary, so this exercises the real
 * repository code - the select strings, the fallback, the guards - rather than a
 * paraphrase of it.
 */
const assert = require('node:assert/strict');

/** What each table has, per shape. `group` adds the script's columns and table. */
const COLUMNS = {
  pair: {
    comms_threads: ['id', 'participant_a', 'participant_b', 'created_at', 'updated_at'],
    comms_messages: ['id', 'thread_id', 'author_id', 'author_name', 'body', 'created_at'],
    comms_reads: ['thread_id', 'user_id', 'last_read_at'],
  },
  group: {
    comms_threads: ['id', 'participant_a', 'participant_b', 'kind', 'name', 'created_by', 'created_at', 'updated_at'],
    comms_messages: ['id', 'thread_id', 'author_id', 'author_name', 'body', 'created_at'],
    comms_reads: ['thread_id', 'user_id', 'last_read_at'],
    comms_members: ['thread_id', 'user_id', 'joined_at'],
  },
};

function missingTable(table) {
  return {
    message: `Could not find the table 'public.${table}' in the schema cache`,
    code: 'PGRST205',
    details: null,
    hint: "Perhaps you meant the table 'public.comms_messages'",
  };
}

function missingColumn(table, column) {
  return {
    message: `Could not find the '${column}' column of '${table}' in the schema cache`,
    code: 'PGRST204',
    details: null,
    hint: null,
  };
}

/** The PostgREST chain, as far as this repository uses it. */
class Query {
  constructor(work) {
    this.work = work;
    this.filters = [];
    this.single = false;
  }

  select(columns) {
    this.columns = columns;
    return this;
  }

  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  order() {
    return this;
  }

  limit(rows) {
    this.limitTo = rows;
    return this;
  }

  maybeSingle() {
    this.single = true;
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }

  run() {
    return this.work(this);
  }
}



/**
 * A fake `supabase-js` client with just enough behind it.
 *
 * `rows` is the store and `requests` records every read, so a check can assert *how*
 * the repository asked - with the members embed, or in the pair-only shape.
 */
function makeClient(shape) {
  const columns = COLUMNS[shape];
  const rows = Object.fromEntries(Object.keys(columns).map((table) => [table, []]));
  const requests = [];
  const bindings = [];

  function from(table) {
    return {
      select: (list) => new Query((query) => read({ ...query, table, list })),
      insert: (row) => new Query((query) => write('insert', table, row, query)),
      upsert: (row) => new Query((query) => write('upsert', table, row, query)),
      update: (patch) => new Query((query) => write('update', table, patch, query)),
    };
  }

  /** Answers a read the way PostgREST would, missing table, missing column and all. */
  function read(query) {
    if (columns[query.table] === undefined) return { data: null, error: missingTable(query.table) };

    requests.push({ table: query.table, columns: query.list });

    // An embed of a table that is not there fails the whole request, which is the
    // failure that used to take the direct messages down with it.
    for (const embedded of query.list.matchAll(/(\w+)\(/g)) {
      if (columns[embedded[1]] === undefined) return { data: null, error: missingTable(embedded[1]) };
    }

    for (const wanted of query.list.replace(/\w+\([^)]*\)/g, '').split(',')) {
      const column = wanted.trim();
      if (column.length === 0 || column === '*') continue;
      if (columns[query.table].includes(column) === false) {
        return { data: null, error: missingColumn(query.table, column) };
      }
    }

    const matched = rows[query.table].filter((row) => query.filters.every(([column, value]) => row[column] === value));
    const shaped = matched.map((row) => ({
      ...row,
      comms_messages: rows.comms_messages.filter((message) => message.thread_id === row.id),
      comms_reads: rows.comms_reads.filter((readAt) => readAt.thread_id === row.id),
      ...(query.list.includes('comms_members(') && columns.comms_members !== undefined
        ? {
            comms_members: rows.comms_members
              .filter((member) => member.thread_id === row.id)
              .map((member) => ({ user_id: member.user_id })),
          }
        : {}),
    }));

    return query.single ? { data: shaped[0] ?? null, error: null } : { data: shaped, error: null };
  }

  /** Insert, upsert or update, refusing a column this shape does not have. */
  function write(kind, table, payload, query) {
    if (columns[table] === undefined) return { data: null, error: missingTable(table) };

    for (const column of Object.keys(payload)) {
      if (columns[table].includes(column) === false) return { data: null, error: missingColumn(table, column) };
    }

    if (kind === 'update') {
      for (const row of rows[table]) {
        if (query.filters.every(([column, value]) => row[column] === value)) Object.assign(row, payload);
      }

      return { data: null, error: null };
    }

    if (kind === 'upsert' && rows[table].some((row) => row.id === payload.id)) return { data: null, error: null };

    const now = new Date().toISOString();
    // Every column, the way PostgREST hands a row back: null where nothing was given.
    const row = Object.fromEntries(columns[table].map((column) => [column, null]));

    Object.assign(
      row,
      table === 'comms_threads' ? { kind: 'dm', name: '', created_at: now, updated_at: now } : {},
      table === 'comms_messages' ? { id: `message-${rows.comms_messages.length + 1}`, created_at: now } : {},
      table === 'comms_reads' ? { last_read_at: now } : {},
      table === 'comms_members' ? { joined_at: now } : {},
      payload,
    );

    rows[table].push(row);

    return { data: null, error: null };
  }

  const client = {
    from,
    auth: { getUser: async () => ({ data: { user: { id: 'user-a' } } }) },
    channel: () => {
      // What the channel was bound to, which is what a check has to be able to see: a
      // binding for a table that is not in the realtime publication silences the whole
      // channel (measured live), so the list of tables here is a contract.
      const opened = {
        on: (_event, config) => {
          bindings.push(config.table);
          return opened;
        },
        subscribe: () => ({ state: 'joined' }),
      };

      return opened;
    },
    removeChannel: async () => 'ok',
  };

  return { client, rows, requests, bindings };
}

/**
 * The compiled repository, with the fake client handed to it in place of the real
 * `supabase/client` module - the boundary the store is written against.
 */
function makeRepository(shape) {
  const db = makeClient(shape);
  const clientPath = require.resolve('./comms-groups-out/supabase/client.js');

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { getSupabaseBrowserClient: () => db.client, isSupabaseConfigured: true },
  };

  delete require.cache[require.resolve('./comms-groups-out/comms/supabase-comms-repository.js')];

  return { db, repository: require('./comms-groups-out/comms/supabase-comms-repository.js') };
}



(async () => {
  // ---------------------------------------------------------------------------
  // 1. The project as it is deployed today: pairs only, no group script
  // ---------------------------------------------------------------------------
  {
    const { db, repository } = makeRepository('pair');
    const comms = repository.getSupabaseCommsRepository();

    assert.deepEqual(await comms.listThreads('user-a'), [], 'the read falls back instead of throwing');
    assert.match(db.requests[0].columns, /comms_members\(/, 'the group-aware read is tried first');
    assert.doesNotMatch(db.requests[1].columns, /comms_members\(/, 'then the pair-only read is asked');
    assert.equal(db.requests.length, 2, 'and two requests is all that costs');

    const dm = await comms.openThread('user-a', 'user-b');
    assert.equal(dm.id, 'dm:user-a|user-b');
    assert.equal(dm.kind, 'dm', 'a conversation of two reads as a dm');
    assert.deepEqual(dm.participants, ['user-a', 'user-b']);

    const sent = await comms.sendMessage({
      authorId: 'user-a',
      recipientId: 'user-b',
      authorName: 'sweden',
      body: 'still works',
    });
    assert.equal(sent.messages.length, 1, 'a direct message is sent without the migration');

    const listed = await comms.listThreads('user-a');
    assert.equal(listed.length, 1, 'and the conversation is in the list');
    assert.equal(listed[0].messages[0].body, 'still works');

    const read = await comms.markRead('user-b', dm.id);
    assert.equal(read.readAt['user-b'], listed[0].messages[0].createdAt, 'the marker lands on the newest message');

    const before = db.requests.length;
    await comms.markRead('user-b', dm.id);
    assert.equal(db.requests.length, before + 1, 'reading again is one read and no write at all');

    await assert.rejects(
      () => comms.createGroup({ creatorId: 'user-a', creatorName: 'sweden', name: 'THE WARD', memberIds: ['user-b'] }),
      (error) =>
        error.message.startsWith('GROUPS NEED A ONE-TIME DATABASE UPDATE') &&
        error.message.includes('20260921000013_group_conversations.sql'),
      'a group names the script the database is missing',
    );
    await assert.rejects(() => comms.addMember(dm.id, 'user-z'), /ONE-TIME DATABASE UPDATE/);
    assert.equal(db.rows.comms_threads.length, 1, 'and nothing half-made was written');

    const embeds = db.requests.filter((request) => /comms_members\(/.test(request.columns));
    assert.equal(embeds.length, 1, 'the fallback is remembered rather than re-tried');

    // A channel may only be bound to tables the project publishes and has. This database
    // has neither the group tables nor a published comms_reads, so a channel here watches
    // the two tables it can rely on - and nothing else, because one bad binding takes the
    // whole channel quiet (which is what hid every message on the live site).
    const offA = comms.subscribe(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(db.bindings.slice().sort(), ['comms_messages', 'comms_threads'], 'the pair-only project binds two tables');
    offA();

    console.log('  deployed db : the pair-only read lands, 1 dm sent, groups say what to run');
  }

  // ---------------------------------------------------------------------------
  // 2. The same project after supabase/migrations/20260921000013_group_conversations.sql
  // ---------------------------------------------------------------------------
  {
    const { db, repository } = makeRepository('group');
    const { GROUPS_NEED_MIGRATION } = repository;
    const comms = repository.getSupabaseCommsRepository();

    const published = [];
    const unsubscribe = comms.subscribe((threads) => published.push(threads));

    const group = await comms.createGroup({
      creatorId: 'user-a',
      creatorName: 'sweden',
      name: 'THE WARD',
      memberIds: ['user-b', 'user-c'],
    });

    assert.equal(group.kind, 'group');
    assert.equal(group.name, 'THE WARD');
    assert.deepEqual(group.participants, ['user-a', 'user-b', 'user-c'], 'the creator plus everybody named');
    assert.equal(db.requests[0].columns, 'kind', 'the group columns are asked about before anything is written');
    assert.ok(
      db.requests.some((request) => request.table === 'comms_threads' && /comms_members\(/.test(request.columns)),
      'and a group is then read from the membership table',
    );
    assert.equal(db.rows.comms_threads[0].participant_a, null, 'a group stores no pair at all');
    assert.deepEqual(
      db.rows.comms_members.map((member) => member.user_id),
      ['user-a', 'user-b', 'user-c'],
      'one membership row each, the creator first',
    );
    assert.equal(GROUPS_NEED_MIGRATION.includes('schema.sql'), true, 'the message points at both files');

    const sent = await comms.sendMessage({
      authorId: 'user-b',
      threadId: group.id,
      authorName: 'luke',
      body: 'anybody here',
    });
    assert.equal(sent.messages.length, 1, 'a message addressed to a group lands in it');
    assert.equal(published.at(-1)[0].messages.at(-1).body, 'anybody here', 'the write reaches the listeners at once');

    const widened = await comms.addMember(group.id, 'user-z');
    assert.equal(widened.participants.length, 4, 'anybody in the group can add somebody');
    assert.equal(published.at(-1)[0].participants.length, 4, 'and the member list is republished');

    await comms.markRead('user-b', group.id);
    await comms.markRead('user-b', group.id);
    assert.equal(db.rows.comms_reads.length, 1, 'a read marker is written once, not once per render');

    // A group project binds the membership table as well - and never `comms_reads`, which
    // the publication does not carry: binding it was what silenced every event before.
    assert.equal(db.bindings.includes('comms_members'), true, 'membership is watched where the group script has run');
    assert.equal(db.bindings.includes('comms_reads'), false, 'reads is not watched: an unpublished table silences the channel');
    assert.equal(db.bindings.includes('comms_messages'), true, 'and messages are');
    assert.equal(db.bindings.includes('comms_threads'), true, 'and conversations are');

    unsubscribe();
    console.log('  migrated db :', group.id.slice(0, 10) + '...', ':: 3 members, 4 after an add, 1 read marker');
  }

  console.log('comms store checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
