/**
 * The media servers WEB reads: Luke's own and his friends' (SPEC-media-servers.md). THIS IS THE FILE TO EDIT.
 *
 * Each server publishes a list file of what it holds; the hourly WEB update reads it and the titles show in
 * the /web stream, one entry per title however many servers hold it, with a SERVER button for each. Videos
 * play straight from the server's own player: the site never stores, copies or passes on a video.
 *
 * One entry per server:
 * - `id`: ours, lowercase letters, digits and `_`, starting with a letter. Part of every saved row: never change a
 *   server's id.
 * - `label`: the name on its button, in capitals.
 * - `base`: the server's https address, nothing after the host. Every list, picture and player address the
 *   site uses for this server must be on this host; anything else in its list file is dropped.
 * - `listPath`: `'*'`, the usual choice since 2026-11-07 (Luke: no list needed, and no waiting for the hourly update): the server plays
 *   any title by its TMDB number, so every film or show a /media search finds on TMDB gets a button for it at once (wildcard-search.ts). Each
 *   server is asked first, and a 404 from its player page means no button. Or the path of a list file on that host, for
 *   a server that lists what it holds: that shows only those titles, and also its own videos TMDB doesn't know, after the next hourly update.
 * - `play`: the server's player page for a film, an episode of a show, (optional) a whole show, and (optional)
 *   one of its own videos with no TMDB number. `{tmdb}`, `{season}`, `{episode}` and `{id}` are filled in with
 *   checked values only.
 * - `unsandboxed: true` (optional, after `play`): its player loads with no sandbox, for a player page that refuses
 *   to start in one (Luke, 2026-11-01). It still gets no referrer. Leave it out unless a server needs it: without
 *   the sandbox, that server's page can open pop-ups and send the whole debaser.site tab to another page.
 *
 * Adding a server here has the next hourly update read its list. Servers are not SOURCE choices in the /web search
 * (Luke, 2026-11-02): their titles show in every search. A show listed as a whole (no season and episode) is offered
 * every season and episode TMDB lists for it (media-titles.ts `withTmdbEpisodes`). The friend's side of it is in docs/media-server-setup.md.
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
  /** Its player loads with no sandbox (`playerSandbox`). Absent: sandboxed, like every other player. */
  readonly unsandboxed?: true;
};

// The slots: one line per friend between the two markers. Fill one with the program, or copy this shape and change the
// id, name and address (docs/media-server-fill-in.md is what to ask each friend for):
//   { id: 'friend_1', label: 'FRIEND 1', base: 'https://media.friend.example', listPath: '/debaser/list.json', play: { movie: '/debaser/play/movie/{tmdb}', tv: '/debaser/play/tv/{tmdb}/{season}/{episode}', series: '/debaser/play/tv/{tmdb}', other: '/debaser/play/item/{id}' } },
// The "Debaser Servers" program on Luke's desktop (tools/server-editor/) rewrites the lines between the two
// SERVERS markers, one server per line in exactly this shape. Edit by hand in the same shape, or use the program.
// Typed as a plain list (not `as const`) so an empty list still builds; an id is then any string, checked by
// `isMediaServerId` at run time.
export const MEDIA_SERVERS: readonly MediaServer[] = [
  // SERVERS-START
  // (Placeholder slots)
// SERVERS-END
];

export type MediaServerId = string;

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
  // The switch is added only when on, so a list without it keeps the fingerprint it always had.
  return servers.map((s) => [s.id, s.label, s.base, s.listPath, s.play.movie, s.play.tv, s.play.other ?? '', s.play.series ?? '', ...(s.unsandboxed === true ? ['unsandboxed'] : [])].join('|') + '\n').join('');
}

/** The sandbox a server's player frame gets: scripts on its own origin only, or none for an `unsandboxed` server. */
export function playerSandbox(server: Pick<MediaServer, 'unsandboxed'>): string | undefined {
  return server.unsandboxed === true ? undefined : 'allow-scripts allow-same-origin';
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
