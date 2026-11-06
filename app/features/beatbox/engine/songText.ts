// Turns whatever someone pasted into the song data BeepBox can read.
// Accepts a beepbox.co link, a beepbox.co player link, bare song data, or JSON.

export class SongLoadError extends Error {
  override name = "SongLoadError";
}

const NO_SONG_IN_LINK =
  "That link has no song in it. A BeepBox link has a long code after a # mark. " +
  "If it is a short link, open it first, then copy the long address.";

function isLink(text: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^www\./i.test(text) || /^[\w-]+(\.[\w-]+)+\//.test(text);
}

// A player link keeps the song in "song=..." next to other settings.
function songFromHash(hash: string): string {
  let decoded = hash;
  try {
    decoded = decodeURIComponent(hash);
  } catch {
    // Not percent-encoded, so use it as it is.
  }
  if (decoded.trimStart().startsWith("{")) return decoded;
  const field = decoded.split("&").find((part) => part.startsWith("song="));
  return field ? field.slice("song=".length) : decoded;
}

export function extractSongData(pasted: string): string {
  const text = pasted.trim();
  if (text === "") throw new SongLoadError("Paste a song link first.");
  if (text.startsWith("{")) return text;

  const hashAt = text.indexOf("#");
  if (hashAt === -1) {
    if (isLink(text)) throw new SongLoadError(NO_SONG_IN_LINK);
    return text;
  }

  const data = songFromHash(text.slice(hashAt + 1)).trim();
  if (data === "") throw new SongLoadError(NO_SONG_IN_LINK);
  return data;
}
