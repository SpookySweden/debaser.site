/* Putting a lens on a frame or a tab, and asking what is there. The page must be one the reader let the machine act on, or the tab in front. */
export const THEME_AT_FIRST = { paper: '#1a1525', ink: '#ffffff', accent: '#fff000', quiet: '#e1ff00', fault: '#e6004c', faultInk: '#ffffff', sun: '#fff000', scheme: 'dark' };

export async function theme() {
  return (await chrome.storage.local.get('theme')).theme ?? THEME_AT_FIRST;
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
    for (const [label, press] of keys ?? []) {
      const key = document.createElement('button');
      key.textContent = '[ ' + label + ' ]';
      key.addEventListener('click', press);
      row.append(key);
    }
    into.append(row);
  }
}
