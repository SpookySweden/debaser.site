/*
 * The bookmarks-bar key (Luke, 2026-11-27: "Bookmarks-bar key (no install)"): what the bookmark runs on the page in front, after the lenses
 * themselves (extension/lens.js, the very file the extension wears). A strip of keys in words on that page, in that tab. It asks the network for
 * nothing and reads nothing but what the page shows; a thing the page plays goes to debaser.site only on a press, by opening an address there.
 * It runs as the page, so it writes no markup from words, and its styles go on as sheet objects where the page forbids style elements.
 */
globalThis.debaserKey = (see, given, site) => {
  const MARK = 'debaser-key';
  const old = document.getElementById(MARK);
  if (old !== null) {
    // Pressed again: put away, and the page as it was.
    old.remove();
    see.off();
    return;
  }
  // Colours and nothing else: anything that isn't one is the house's own.
  const HOUSE = { paper: '#1a1525', ink: '#ffffff', accent: '#fff000', quiet: '#e1ff00', fault: '#e6004c', faultInk: '#ffffff', sun: '#fff000' };
  const theme = {};
  for (const name of Object.keys(HOUSE)) theme[name] = typeof given === 'object' && given !== null && /^#[0-9a-f]{6}$/i.test(given[name]) ? given[name] : HOUSE[name];

  const host = document.createElement('div');
  host.id = MARK;
  const shadow = host.attachShadow({ mode: 'open' });
  const css = `:host{all:initial;position:fixed;top:0;right:0;z-index:2147483647;max-width:100vw;box-sizing:border-box;background:${theme.paper};color:${theme.ink};border:1px solid ${theme.ink};font:12px/1.5 'IBM Plex Mono','Courier New',monospace}.bar{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:2px 4px}button{all:unset;cursor:pointer;padding:0 4px;border:1px solid ${theme.ink};color:${theme.ink};font:inherit}button[aria-pressed=true]{background:${theme.ink};color:${theme.paper}}button:focus-visible{outline:2px solid ${theme.accent}}p{margin:0;padding:2px 4px}.list{max-height:50vh;overflow:auto;border-top:1px solid ${theme.ink}}.row{display:flex;align-items:baseline;gap:6px;padding:2px 4px}.row span{max-width:28rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}[hidden]{display:none}`;
  const bar = document.createElement('div');
  bar.className = 'bar';
  const said = document.createElement('p');
  said.setAttribute('role', 'status');
  said.hidden = true;
  const list = document.createElement('div');
  list.className = 'list';
  list.hidden = true;
  const say = (words) => {
    said.textContent = words;
    said.hidden = words === '';
  };
  const key = (label, press) => {
    const made = document.createElement('button');
    made.type = 'button';
    made.textContent = '[ ' + label + ' ]';
    made.addEventListener('click', press);
    return made;
  };

  const name = document.createElement('span');
  name.textContent = 'DEBASER';
  bar.append(name);
  const lenses = [];
  for (const [id, label] of [['standard', 'STANDARD'], ['reader', 'READER'], ['xray', 'X-RAY'], ['lowfi', 'LOW-FI'], ['yours', 'YOUR THEME']]) {
    const made = key(label, () => {
      for (const each of lenses) each.setAttribute('aria-pressed', String(each === made));
      say(see.put(id, theme) ?? '');
      // Over READER's page, which covers everything put on before it.
      document.documentElement.append(host);
    });
    made.setAttribute('aria-pressed', String(id === 'standard'));
    made.dataset.lens = id;
    lenses.push(made);
    bar.append(made);
  }
  const media = key('MEDIA', () => {
    const open = list.hidden;
    list.hidden = !open;
    media.setAttribute('aria-expanded', String(open));
    list.replaceChildren();
    if (!open) return;
    const found = see.media();
    if (found.length === 0) {
      const none = document.createElement('p');
      none.textContent = 'NOTHING FOUND.';
      list.append(none);
    }
    for (const { address, title } of found) {
      const row = document.createElement('div');
      row.className = 'row';
      const words = document.createElement('span');
      words.textContent = title;
      words.title = address;
      // To the Room, by way of the site: it opens with the thing in its tray, waiting for a press there.
      row.append(words, key('TO DEBASER ↗', () => window.open(`${site}/browser#media=${encodeURIComponent(address)}&title=${encodeURIComponent(title.slice(0, 160))}`, '_blank', 'noopener,noreferrer')));
      list.append(row);
    }
  });
  media.setAttribute('aria-expanded', 'false');
  media.dataset.key = 'media';
  const away = key('PUT AWAY', () => {
    host.remove();
    see.off();
  });
  away.dataset.key = 'away';
  bar.append(media, away);
  // Its rules as a sheet object: a page's own content policy forbids style elements, and is told of each one tried.
  try {
    const made = new CSSStyleSheet();
    made.replaceSync(css);
    shadow.adoptedStyleSheets = [made];
  } catch {
    // A browser without sheet objects: an element, where the page lets one be.
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);
  }
  shadow.append(bar, said, list);
  document.documentElement.append(host);
};
