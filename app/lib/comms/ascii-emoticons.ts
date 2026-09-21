/**
 * The emoticon shelf: text faces, no pictures, no Unicode.
 *
 * The whole site is drawn in ASCII (see AGENTS.md - nothing draws an illustration in
 * code), so the "emoji" a message can carry are the ones a keyboard can already type.
 * They are grouped so the picker can lay them out in rows, and every one that is not a
 * deliberate kaomoji is as short as typing it would be.
 */
export type AsciiEmoticon = {
  text: string;
  /** Shown as the button's tooltip, so the shelf explains itself. */
  about: string;
};

export type AsciiEmoticonGroup = {
  id: string;
  label: string;
  emoticons: AsciiEmoticon[];
};

export const ASCII_EMOTICONS: AsciiEmoticonGroup[] = [
  {
    id: 'faces',
    label: 'FACES',
    emoticons: [
      { text: ':)', about: 'SMILING' },
      { text: ':(', about: 'SAD' },
      { text: ':D', about: 'GRINNING' },
      { text: ';)', about: 'WINKING' },
      { text: ':P', about: 'TONGUE OUT' },
      { text: ':O', about: 'SURPRISED' },
      { text: ':|', about: 'FLAT' },
      { text: ':/', about: 'UNSURE' },
      { text: '>:)', about: 'MISCHIEF' },
      { text: ":'(", about: 'CRYING' },
      { text: 'XD', about: 'LAUGHING HARD' },
      { text: 'D:', about: 'ALARMED' },
    ],
  },
  {
    id: 'text-faces',
    label: 'TEXT FACES',
    emoticons: [
      { text: '^_^', about: 'CONTENT' },
      { text: 'T_T', about: 'WEEPING' },
      { text: 'O_o', about: 'CONFUSED' },
      { text: '-_-', about: 'UNIMPRESSED' },
      { text: '>_<', about: 'SQUINTING' },
      { text: '(o_o)', about: 'STARING' },
      { text: ':3', about: 'CAT' },
      { text: ':V', about: 'BEAK' },
      { text: '@_@', about: 'DIZZY' },
      { text: '*_*', about: 'STARSTUCK' },
      { text: 'x_x', about: 'KNOCKED OUT' },
      { text: 'n_n', about: 'PLEASED' },
    ],
  },
  {
    id: 'gestures',
    label: 'GESTURES AND THINGS',
    emoticons: [
      { text: '<3', about: 'HEART' },
      { text: '</3', about: 'BROKEN HEART' },
      { text: 'o/', about: 'SALUTE' },
      { text: '\\o/', about: 'CHEER' },
      { text: '===)', about: 'A SWORD' },
      { text: '[==]', about: 'A CASSETTE' },
      { text: ':::', about: 'STATIC' },
      { text: '...', about: 'TRAILING OFF' },
      { text: '!!!', about: 'SHOUTING' },
      { text: '???', about: 'PUZZLED' },
      { text: '***', about: 'EMPHASIS' },
      { text: '---', about: 'A LINE' },
    ],
  },
];

/**
 * Drops an emoticon into a message at the caret.
 *
 * Returns the whole value and where the caret belongs afterwards, so a caller can
 * write both back to a real textarea: the selection is replaced (or the text is
 * inserted where there was no selection), and the caret is left after what arrived -
 * which is what makes picking two in a row feel like typing rather than pasting.
 */
export function insertAtCaret(
  value: string,
  start: number,
  end: number,
  snippet: string,
): { value: string; caret: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));

  return { value: `${value.slice(0, from)}${snippet}${value.slice(to)}`, caret: from + snippet.length };
}
