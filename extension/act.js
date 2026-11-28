/* Putting a lens on a frame or a tab, and asking what is there. The page must be one the reader let the machine act on, or the tab in front. */
export const THEME_AT_FIRST = { paper: '#1a1525', ink: '#ffffff', accent: '#fff000', quiet: '#e1ff00', fault: '#e6004c', faultInk: '#ffffff', sun: '#fff000', scheme: 'dark' };

export async function theme() {
  return (await settings()).wear ? ((await chrome.storage.local.get('theme')).theme ?? THEME_AT_FIRST) : THEME_AT_FIRST;
}

/** What the reader set in the site's EXTENSION panel. */
export const SETTINGS_AT_FIRST = { lens: 'standard', wear: true };
export async function settings() {
  return { ...SETTINGS_AT_FIRST, ...(await chrome.storage.local.get('settings')).settings };
}

/** The theme on one of the extension's own pages. */
export async function wear() {
  const now = await theme();
  for (const [name, value] of Object.entries(now)) if (name !== 'scheme') document.documentElement.style.setProperty('--' + name, value);
  document.documentElement.style.colorScheme = now.scheme;
}

async function run(target, func, args = []) {
  await chrome.scripting.executeScript({ target, files: ['lens.js'] });
  const [answer] = await chrome.scripting.executeScript({ target, func, args });
  return answer?.result ?? null;
}

export const putLens = async (target, lens) => run(target, (name, colours) => globalThis.debaserSee.put(name, colours), [lens, await theme()]);
export const findMedia = (target) => run(target, () => globalThis.debaserSee.media());
export const findWatchers = (target) => run(target, () => globalThis.debaserSee.watchers());

const SITE = 'https://debaser.site';
/** To the Room, by way of the site: it opens with the thing in its tray, waiting for a press there. */
export const toRoom = (address, title) => chrome.tabs.create({ url: `${SITE}/browser#media=${encodeURIComponent(address)}&title=${encodeURIComponent(title.slice(0, 160))}` });
/** The same page through the server's eye, signed out. */
export const toServerEye = (address) => chrome.tabs.create({ url: `${SITE}/browser#see=${encodeURIComponent(address)}` });

export const LENSES = [
  ['standard', 'STANDARD'],
  ['reader', 'READER'],
  ['xray', 'X-RAY'],
  ['lowfi', 'LOW-FI'],
  ['yours', 'YOUR THEME'],
];

/**
 * What each key does and why, in plain words, shown when the pointer rests on it (Luke, 2026-11-27: "hovering over any buttons gives a detailed
 * explaination of the function and purpose"). The site's [ EXPLAIN ] switch can't reach an extension's page, so here they are always on.
 */
export const LENS_WORDS = {
  standard: 'The page as its site made it. Takes off whichever lens is on.',
  reader: 'Only the main text and its pictures, in one plain column over the page: for reading without the menus, adverts and boxes round it.',
  xray: 'Draws a line round every part of the page: text, links, pictures, frames and forms each in their own line, to show how it is built.',
  lowfi: 'Strips the page to plain text colours and one typeface, with its pictures grey and blocky: quieter, and easier on the eyes.',
  yours: 'Recolours the page in the theme you wear on debaser.site: your paper, your ink, your link colour.',
};
/** What adding a site by name costs, said wherever ADD is offered (decision 67). */
export const NAMED_COST = 'A site added by name is shown even when that means switching off its own script-safety rules (its Content-Security-Policy) while it is inside BROWSER or the machine. Some sites, DuckDuckGo and GitHub among them, only show that way.';
export const KEY_WORDS = {
  serverEye: 'Opens this page in BROWSER on debaser.site through the SERVER EYE: fetched by the house, never signed in, rebuilt through the lenses. The site sees the house, not you. The site name and the time are written down there.',
  tab: 'Opens this page in an ordinary tab of your browser, where every site works as usual. The lenses are in the side panel there.',
  toRoom: 'Opens debaser.site with this video or sound waiting in BROWSER\'s tray: one press there plays it in your room or adds it to the queue. Nothing plays until you press.',
  remove: 'Takes this site off the list: the machine may no longer act on it or show it signed in, until you add it again.',
  add: 'Adds this site to the list, so the machine and BROWSER on debaser.site may show it from your own browser, signed in as you, and put a lens on it. Your browser asks you too. ' + NAMED_COST,
  every: 'Lets the machine and BROWSER on debaser.site show ANY site from your own browser, signed in as you, with no ADD step for each one, like an ordinary browser. Your browser asks you first, in its own box, and says the extension may read and change your data on all websites: it needs that leave to show a page inside another and to put a lens on it. The few lines it then runs on every page stop at their first line, reading and sending nothing, unless the page is shown directly inside a debaser.site page or the machine. Inside a debaser.site page they ask that page one fixed question, whether this is the frame BROWSER made for OWN EYE, and say nothing more unless it answers yes. Only in that one frame, and in the machine, do they tell this extension the address and title of the page, for the address box in BROWSER and the lenses. Sign-in pages, banks and payments are still never shown inside anything. Off until you press this; the same key takes it back.',
  everyBack: 'Takes back the leave for every site, at once and with no box. Sites you added by name stay on the list below; every other site needs ADD again before it is shown.',
  addGroup: 'Adds every site this company signs you in across, in one press, so its sign-in works here. Your browser asks you too, naming them.',
};

/** A list of things with a key each, in words only. */
export function list(into, rows, empty) {
  into.replaceChildren();
  if (rows.length === 0) {
    const none = document.createElement('p');
    none.textContent = empty;
    into.append(none);
    return;
  }
  for (const { words, small, keys } of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = words;
    row.append(name);
    if (small) {
      const under = document.createElement('small');
      under.textContent = small;
      row.append(under);
    }
    for (const [label, press, about] of keys ?? []) {
      const key = document.createElement('button');
      key.textContent = '[ ' + label + ' ]';
      if (about) key.title = about;
      key.addEventListener('click', press);
      row.append(key);
    }
    into.append(row);
  }
}
