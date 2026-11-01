/**
 * The media servers WEB reads: Luke's own and his friends' (SPEC-media-servers.md). THIS IS THE FILE TO EDIT.
 *
 * Each server publishes a list file of what it holds; the hourly WEB update reads it and the titles show in
 * the /web stream, one entry per title however many servers hold it, with a SERVER button for each. Videos
 * play straight from the server's own player: the site never stores, copies or passes on a video.
 *
 * One entry per server:
 * - `id`: ours, lowercase letters, digits and `_`, starting with a letter. It is what `in:` takes in the
 *   /web search, with `-` for `_` (`in:server-1`), and part of every saved row: never change a server's id.
 * - `label`: the name on its SOURCE choice and its button, in capitals.
 * - `base`: the server's https address, nothing after the host. Every list, picture and player address the
 *   site uses for this server must be on this host; anything else in its list file is dropped.
 * - `listPath`: where its list file sits on that host, or `'*'` for a server with no list file that plays any title
 *   by its TMDB number: the hourly update skips it, and every film or show a /web search finds on TMDB gets a
 *   button for it (wildcard-search.ts).
 * - `play`: the server's player page for a film, an episode of a show, (optional) a whole show, and (optional)
 *   one of its own videos with no TMDB number. `{tmdb}`, `{season}`, `{episode}` and `{id}` are filled in with
 *   checked values only.
 *
 * Adding a server here adds its SOURCE choice in the /web search by itself (web-filters.ts) and has the next
 * hourly update read its list. The friend's side of it is in docs/media-server-setup.md.
 */

export type MediaServer = {
  readonly id: string;
  readonly label: string;
  readonly base: string;
  readonly listPath: string;
  readonly play: {
    readonly movie: string;
    readonly tv: string;
    /** A whole show (its own season list, or play from the start): `{tmdb}` only. */
    readonly series?: string;
    readonly other?: string;
  };
};

// The two placeholders stand in until a real server exists: nothing answers there, so their titles say NOT ANSWERING.
// The "Debaser Servers" program on Luke's desktop (tools/server-editor/) rewrites the lines between the two
// SERVERS markers, one server per line in exactly this shape. Edit by hand in the same shape, or use the program.
export const MEDIA_SERVERS = [
  // SERVERS-START
  { id: 'server_1', label: 'SERVER 1', base: 'https://placeholder-server1.xyz', listPath: '/debaser/list.json', play: { movie: '/debaser/play/movie/{tmdb}', tv: '/debaser/play/tv/{tmdb}/{season}/{episode}', series: '/debaser/play/tv/{tmdb}', other: '/debaser/play/item/{id}' } },
  { id: 'server_2', label: 'SERVER 2', base: 'https://placeholder-server2.xyz', listPath: '/debaser/list.json', play: { movie: '/debaser/play/movie/{tmdb}', tv: '/debaser/play/tv/{tmdb}/{season}/{episode}', series: '/debaser/play/tv/{tmdb}', other: '/debaser/play/item/{id}' } },
  // SERVERS-END
] as const satisfies readonly MediaServer[];

export type MediaServerId = (typeof MEDIA_SERVERS)[number]['id'];

/** The servers' ids, for code that only needs to know whether a word names one. */
export const MEDIA_SERVER_IDS: readonly MediaServerId[] = MEDIA_SERVERS.map((server) => server.id);

export function isMediaServerId(value: unknown): value is MediaServerId {
  return typeof value === 'string' && (MEDIA_SERVER_IDS as readonly string[]).includes(value);
}

export function mediaServer(id: MediaServerId): MediaServer {
  return MEDIA_SERVERS.find((server) => server.id === id) as MediaServer;
}

/**
 * The server list as one line of text per server, in order: what `/api/web/media/servers-version` hashes, so the
 * desktop program (which builds the same text from what it saved) can tell when the live site runs its list.
 * Change this and DebaserServers.cs `ListText` together.
 */
export function serverListText(servers: readonly MediaServer[] = MEDIA_SERVERS): string {
  return servers.map((s) => [s.id, s.label, s.base, s.listPath, s.play.movie, s.play.tv, s.play.other ?? '', s.play.series ?? ''].join('|') + '\n').join('');
}

/** `listPath` for a server with no list file: it plays any title by its TMDB number. */
export const WILDCARD_LIST_PATH = '*';

export function isWildcardServer(server: Pick<MediaServer, 'listPath'>): boolean {
  return server.listPath === WILDCARD_LIST_PATH;
}

/** A server's host (`placeholder-server1.xyz`). */
export function serverHost(server: Pick<MediaServer, 'base'>): string {
  return new URL(server.base).hostname;
}
