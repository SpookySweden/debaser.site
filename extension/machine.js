/*
 * OWN EYE: the machine's own page. A site is shown in a frame here, fetched by this browser, where the reader is signed in: its cookies come
 * because this page is the extension's and has leave for that site. The frame can't move this page (no allow-top-navigation). Signing in is
 * always done in an ordinary tab: a sign-in page is never framed.
 */
import { findMedia, findWatchers, KEY_WORDS, LENS_WORDS, LENSES, list, NAMED_COST, putLens, settings, toRoom, toServerEye, wear } from './act.js';
import { allowedSites, EVERY_SITE, everySite, groupOf, inATab, isAllowed, isNamed, neverFramed, originsOf, originsOfAll, readAddress, SIGN_IN_GROUPS, siteOf } from './sites.js';

const at = (id) => document.getElementById(id);
const frame = at('page');
let address = null;
let lens = (await settings()).lens;
let beside = null;

const say = (words, fault = false) => {
  at('status').textContent = words;
  at('status').classList.toggle('fault', fault);
};

/** Which frame the page is in, as it said itself (frame.js); none until it has. */
let frameId = null;
async function target() {
  if (frame.hidden || frameId === null) return null;
  return { tabId: (await chrome.tabs.getCurrent()).id, frameIds: [frameId] };
}
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.see !== 'frame' || typeof message.href !== 'string') return;
  void chrome.tabs.getCurrent().then(async (tab) => {
    // This page's own frame: another machine in another tab is not this one.
    if (sender.tab?.id !== tab.id || frame.hidden || !/^https?:/.test(message.href)) return;
    frameId = sender.frameId;
    address = message.href;
    at('address').value = address;
    history.replaceState(null, '', '#see=' + encodeURIComponent(address));
    document.title = typeof message.title === 'string' && message.title !== '' ? message.title + ' : OWN EYE' : 'DEBASER SEEING MACHINE';
    await wearLens();
    if (beside !== null) await open(beside);
  });
});

/** A press that adds sites by name (and everything under their names, in one box of the browser's), then shows the page again. */
const adding = (read, sites) => async () => {
  if (await chrome.permissions.request({ origins: originsOfAll(sites) })) {
    await chrome.runtime.sendMessage({ see: 'rules' });
    await show(read);
  }
};

async function show(text) {
  const read = readAddress(text);
  if (read === null) return say("THAT ISN'T AN ADDRESS", true);
  address = read;
  at('address').value = read;
  history.replaceState(null, '', '#see=' + encodeURIComponent(read));
  const site = siteOf(new URL(read).hostname);
  frame.hidden = true;
  at('door').hidden = false;
  const group = groupOf(site);
  const add = (sites) => adding(read, sites);
  if (inATab(read)) {
    frame.removeAttribute('src');
    door("THIS SITE STOPS ITSELF IN A FRAME. IN AN ORDINARY TAB IT IS AS IN YOUR BROWSER, AND THE MACHINE'S LENSES ARE IN ITS SIDE PANEL.", 'OPEN IT IN A TAB', () => chrome.runtime.sendMessage({ see: 'tab', address: read }), KEY_WORDS.tab);
    // The key that brought the reader here from BROWSER says ADD (Luke's morning, 2026-11-27: no key that leads nowhere): adding is done here
    // all the same. An added site's player in BROWSER on debaser.site takes a lens, and a video clicked inside it is followed.
    if (await isAllowed(read)) {
      door2(`✓ ${(await isNamed(read)) ? site + ' IS ON THE LIST' : 'EVERY SITE IS ALLOWED'}. BROWSER ON DEBASER.SITE SHOWS ITS VIDEOS IN ITS OWN TAB, PUTS A LENS ON THEM, AND FOLLOWS A VIDEO YOU CLICK THERE. GO BACK TO THAT TAB: NOTHING ELSE TO PRESS HERE.`);
      return say(`ALLOWED: ${site} · IT OPENS IN AN ORDINARY TAB`);
    }
    door2(`ADD IT AND BROWSER ON DEBASER.SITE MAY PUT A LENS ON ITS VIDEOS AND FOLLOW A VIDEO YOU CLICK THERE. YOUR BROWSER ASKS TOO.`, `ADD ${site}`, add([site]), KEY_WORDS.add);
    if (group !== null) door2(`${group.name} SIGNS YOU IN TO ${group.sites.join(', ')}.`, `ADD ALL OF ${group.name}`, add(group.sites), KEY_WORDS.addGroup);
    return say(`NOT ADDED: ${site} · IT OPENS IN AN ORDINARY TAB`, true);
  }
  if (neverFramed(read)) {
    frame.removeAttribute('src');
    door('SIGN-IN PAGES ARE NEVER SHOWN IN A FRAME.', 'OPEN IT IN A TAB', () => chrome.tabs.create({ url: read }), 'Opens this sign-in page in an ordinary tab of your browser. A sign-in is never shown inside another page, so nobody can dress one up as something else.');
    return say('SIGN-INS HAPPEN IN AN ORDINARY TAB', true);
  }
  if (!(await isAllowed(read))) {
    frame.removeAttribute('src');
    door(`THE MACHINE MAY ACT ON A SITE ONLY WHEN YOU ADD IT.`, `ADD ${site}`, add([site]), KEY_WORDS.add);
    // A site that shares its sign-in: the rest of them, named before the press.
    if (group !== null) door2(`${group.name} SIGNS YOU IN TO ${group.sites.join(', ')}.`, `ADD ALL OF ${group.name}`, add(group.sites), KEY_WORDS.addGroup);
    return say(`NOT ADDED: ${site}`);
  }
  at('door').hidden = true;
  frame.hidden = false;
  frameId = null;
  frame.src = read;
  say('ACQUIRING SOURCE');
}

/** A line and its key; `about` is what the key does and why, shown when the pointer rests on it. A line with no key is words only. */
function offer(words, label, press, about) {
  const line = document.createElement('p');
  line.textContent = words;
  if (label === undefined) return [line];
  const key = document.createElement('button');
  key.textContent = '[ ' + label + ' ]';
  if (about) key.title = about;
  key.addEventListener('click', press);
  return [line, key];
}

/** A second offer under the first. */
function door2(words, label, press, about) {
  at('door').append(...offer(words, label, press, about));
}

function door(words, label, press, about) {
  at('door').replaceChildren(...offer(words, label, press, about));
}

frame.addEventListener('load', () => {
  const was = frameId;
  setTimeout(async () => {
    // Loaded, and nothing in it has said where it is: it would not be shown, or it went to a site that was not added.
    if (frame.hidden || frameId !== was || was !== null) return;
    say("THE SITE CAN'T BE SHOWN HERE: OPEN IT IN A TAB", true);
    // Under EVERY SITE a page that only shows with its script-safety rules off is left whole, so it stays out until its site is added by name.
    const read = address;
    if (read === null || !(await everySite()) || (await isNamed(read)) || read !== address || frameId !== null) return;
    const site = siteOf(new URL(read).hostname);
    frame.hidden = true;
    at('door').hidden = false;
    door("IT DIDN'T SHOW HERE. EITHER THIS SITE ONLY SHOWS INSIDE ANOTHER WITH ITS OWN SCRIPT-SAFETY RULES SWITCHED OFF, WHICH [ ALLOW EVERY SITE ] NEVER DOES, OR IT IS A SIGN-IN PAGE. A TAB SHOWS IT AS USUAL.", 'OPEN IT IN A TAB', () => chrome.runtime.sendMessage({ see: 'tab', address: read }), KEY_WORDS.tab);
    door2(`ADD ${site} BY NAME AND IT IS SHOWN HERE WITH THOSE RULES OFF WHILE IT IS INSIDE BROWSER OR THE MACHINE. YOUR BROWSER ASKS TOO.`, `ADD ${site}`, adding(read, [site]), KEY_WORDS.add);
  }, 2500);
});

async function wearLens() {
  const where = await target();
  if (where === null) return;
  const said = await putLens(where, lens).catch(() => null);
  say(said ?? `DOCUMENT SHOWN · OWN EYE · LENS: ${LENSES.find(([id]) => id === lens)[1]}`, said !== null);
}

async function open(which) {
  beside = which;
  for (const id of ['media', 'watchers', 'sites']) at(id).setAttribute('aria-expanded', String(which === id));
  at('beside').hidden = which === null;
  if (which === null) return;
  const into = at('beside');
  if (which === 'sites') {
    const sites = await allowedSites();
    list(into, sites.map((site) => ({ words: site, keys: [['REMOVE', async () => {
      await chrome.permissions.remove({ origins: originsOf(site) });
      await chrome.runtime.sendMessage({ see: 'rules' });
      await open('sites');
    }, KEY_WORDS.remove]] })), 'NO SITE ADDED BY NAME.');
    // ALLOW EVERY SITE (Luke, 2026-11-27: "One optional key (Recommended)"): one line above the list, on or off in words, and its one key.
    const every = await everySite();
    const all = document.createElement('div');
    all.className = 'row';
    all.id = 'every';
    const said = document.createElement('span');
    said.textContent = every ? 'EVERY SITE: ON. ANY PAGE IS SHOWN FROM YOUR OWN BROWSER, SIGNED IN AS YOU. SIGN-INS, BANKS AND PAYMENTS NEVER.' : 'EVERY SITE: OFF. ONLY THE SITES ADDED BY NAME, BELOW, ARE SHOWN.';
    const everyKey = document.createElement('button');
    everyKey.textContent = every ? '[ TAKE IT BACK ]' : '[ ALLOW EVERY SITE ]';
    everyKey.title = every ? KEY_WORDS.everyBack : KEY_WORDS.every;
    everyKey.addEventListener('click', async () => {
      // The press is the one the browser needs for its own box; taking it back asks nothing.
      if (every) await chrome.permissions.remove({ origins: EVERY_SITE });
      else if (!(await chrome.permissions.request({ origins: EVERY_SITE }))) return;
      await chrome.runtime.sendMessage({ see: 'rules' });
      await open('sites');
    });
    all.append(said, everyKey);
    const cost = document.createElement('p');
    cost.id = 'named-cost';
    cost.textContent = 'ADDED BY NAME: ' + NAMED_COST.toUpperCase() + ' EVERY SITE ALONE NEVER SWITCHES THEM OFF: SUCH A PAGE SAYS IT DIDN\'T SHOW, AND OFFERS A TAB OR ADD.';
    into.prepend(all, cost);
    // Sign-ins, each a whole company's sites in one press; and IMPORT, the sites this browser has been to.
    const offers = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = 'ADD A SIGN-IN';
    offers.append(heading);
    for (const group of SIGN_IN_GROUPS) {
      const missing = group.sites.filter((each) => !sites.includes(each));
      if (missing.length === 0) continue;
      const key = document.createElement('button');
      key.textContent = '[ ' + group.name + ' ]';
      key.title = KEY_WORDS.addGroup + ' These: ' + group.sites.join(', ') + '.';
      key.addEventListener('click', async () => {
        if (await chrome.permissions.request({ origins: originsOfAll(missing) })) await chrome.runtime.sendMessage({ see: 'rules' });
        await open('sites');
      });
      offers.append(key);
    }
    const importing = document.createElement('button');
    importing.textContent = '[ IMPORT FROM THIS BROWSER ]';
    importing.title = 'Lists the sites this browser has been to in the last 30 days, by name only, each ticked, so you can add them all in one press instead of one at a time. Your browser asks leave to read its history; it is read once, here, given back at once, and nothing of it leaves this page.';
    importing.addEventListener('click', () => void importSites(offers));
    offers.append(document.createElement('br'), importing);
    into.append(offers);
    return;
  }
  const where = await target();
  if (where === null) return list(into, [], 'NOTHING SHOWN.');
  if (which === 'media') list(into, ((await findMedia(where).catch(() => null)) ?? []).map(({ address: media, title }) => ({ words: title, small: media, keys: [['TO THE ROOM ↗', () => toRoom(media, title), KEY_WORDS.toRoom]] })), 'NOTHING FOUND.');
  else list(into, ((await findWatchers(where).catch(() => null)) ?? []).map(({ host, count }) => ({ words: host, small: String(count) })), 'NOBODY.');
}

/**
 * IMPORT FROM THIS BROWSER: the sites this browser has been to in the last 30 days, by name only, offered ticked (a company's sign-in first). The
 * leave to read the browser's history is asked for on the press, used once and given back; nothing of it leaves this page.
 */
async function importSites(into) {
  if (!(await chrome.permissions.request({ permissions: ['history'] }))) return;
  let visits = [];
  try {
    visits = await chrome.history.search({ text: '', startTime: Date.now() - 30 * 86_400_000, maxResults: 5000 });
  } finally {
    await chrome.permissions.remove({ permissions: ['history'] }).catch(() => undefined);
  }
  const counts = new Map();
  for (const visit of visits) {
    const read = readAddress(visit.url ?? '');
    if (read === null || neverFramed(read)) continue;
    const site = siteOf(new URL(read).hostname);
    counts.set(site, (counts.get(site) ?? 0) + (visit.visitCount ?? 1));
  }
  const already = await allowedSites();
  const offered = [...counts].filter(([site]) => !already.includes(site)).sort((a, b) => Number(groupOf(b[0]) !== null) - Number(groupOf(a[0]) !== null) || b[1] - a[1]).slice(0, 40);
  const box = document.createElement('div');
  box.id = 'import';
  if (offered.length === 0) box.textContent = 'NOTHING NEW TO ADD.';
  for (const [site] of offered) {
    const line = document.createElement('label');
    line.className = 'row';
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = true;
    tick.value = site;
    line.append(tick, ' ' + site + (groupOf(site) ? ' (' + groupOf(site).name + ')' : ''));
    box.append(line);
  }
  const add = document.createElement('button');
  add.textContent = '[ ADD THE TICKED ]';
  add.title = 'Adds every site still ticked above to the list in one press, so the machine may show them signed in. Untick any you do not want first. Your browser asks you too.';
  add.disabled = offered.length === 0;
  add.addEventListener('click', async () => {
    const ticked = [...box.querySelectorAll('input:checked')].map((each) => each.value);
    if (ticked.length > 0 && (await chrome.permissions.request({ origins: originsOfAll(ticked) }))) await chrome.runtime.sendMessage({ see: 'rules' });
    await open('sites');
  });
  box.append(add);
  into.querySelector('#import')?.remove();
  into.append(box);
}

for (const [id, label] of LENSES) {
  const key = document.createElement('button');
  key.textContent = '[ ' + label + ' ]';
  key.title = LENS_WORDS[id] + ' The page stays the site\'s own, from your browser: you stay signed in.';
  key.setAttribute('aria-pressed', String(id === lens));
  key.addEventListener('click', async () => {
    lens = id;
    for (const each of at('lenses').children) each.setAttribute('aria-pressed', String(each === key));
    await wearLens();
  });
  at('lenses').append(key);
}
for (const id of ['media', 'watchers', 'sites']) at(id).addEventListener('click', () => open(beside === id ? null : id));
at('go').addEventListener('submit', (event) => {
  event.preventDefault();
  void show(at('address').value);
});
at('back').addEventListener('click', () => history.back());
at('forward').addEventListener('click', () => history.forward());
at('reload').addEventListener('click', () => address !== null && show(address));
at('tab').addEventListener('click', () => address !== null && chrome.tabs.create({ url: address }));
at('server').addEventListener('click', () => address !== null && toServerEye(address));
chrome.storage.onChanged.addListener(() => void wear().then(wearLens));

// The line the worker holds this tab by. Kept open for as long as this page is; made again if the worker was put to sleep.
const ready = () => new Promise((done) => {
  const port = chrome.runtime.connect({ name: 'machine' });
  port.onMessage.addListener(() => done());
  port.onDisconnect.addListener(() => setTimeout(() => void ready(), 200));
});
await ready();
await wear();
if (location.hash === '#sites') await open('sites');
const brought = /^#see=(.+)$/.exec(location.hash)?.[1];
if (brought !== undefined) {
  // An address brought by a link opens by itself only for a site already added; show() asks first for any other.
  try {
    await show(decodeURIComponent(brought));
  } catch {
    say("THAT ISN'T AN ADDRESS", true);
  }
}
