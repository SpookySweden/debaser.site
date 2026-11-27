/*
 * OWN EYE: the machine's own page. A site is shown in a frame here, fetched by this browser, where the reader is signed in: its cookies come
 * because this page is the extension's and has leave for that site. The frame can't move this page (no allow-top-navigation). Signing in is
 * always done in an ordinary tab: a sign-in page is never framed.
 */
import { findMedia, findWatchers, LENSES, list, putLens, settings, toRoom, toServerEye, wear } from './act.js';
import { allowedSites, groupOf, inATab, isAllowed, neverFramed, originsOf, originsOfAll, readAddress, SIGN_IN_GROUPS, siteOf } from './sites.js';

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

async function show(text) {
  const read = readAddress(text);
  if (read === null) return say("THAT ISN'T AN ADDRESS", true);
  address = read;
  at('address').value = read;
  history.replaceState(null, '', '#see=' + encodeURIComponent(read));
  const site = siteOf(new URL(read).hostname);
  frame.hidden = true;
  at('door').hidden = false;
  if (inATab(read)) {
    frame.removeAttribute('src');
    door("THIS SITE STOPS ITSELF IN A FRAME. IN AN ORDINARY TAB IT IS AS IN YOUR BROWSER, AND THE MACHINE'S LENSES ARE IN ITS SIDE PANEL.", 'OPEN IT IN A TAB', () => chrome.runtime.sendMessage({ see: 'tab', address: read }));
    return say('IN AN ORDINARY TAB', true);
  }
  if (neverFramed(read)) {
    frame.removeAttribute('src');
    door('SIGN-IN PAGES ARE NEVER SHOWN IN A FRAME.', 'OPEN IT IN A TAB', () => chrome.tabs.create({ url: read }));
    return say('SIGN-INS HAPPEN IN AN ORDINARY TAB', true);
  }
  if (!(await isAllowed(read))) {
    frame.removeAttribute('src');
    const group = groupOf(site);
    const add = (sites) => async () => {
      // The sites named, and everything under their names, in one box of the browser's.
      if (await chrome.permissions.request({ origins: originsOfAll(sites) })) {
        await chrome.runtime.sendMessage({ see: 'rules' });
        await show(read);
      }
    };
    door(`THE MACHINE MAY ACT ON A SITE ONLY WHEN YOU ADD IT.`, `ADD ${site}`, add([site]));
    // A site that shares its sign-in: the rest of them, named before the press.
    if (group !== null) door2(`${group.name} SIGNS YOU IN TO ${group.sites.join(', ')}.`, `ADD ALL OF ${group.name}`, add(group.sites));
    return say(`NOT ADDED: ${site}`);
  }
  at('door').hidden = true;
  frame.hidden = false;
  frameId = null;
  frame.src = read;
  say('ACQUIRING SOURCE');
}

/** A second offer under the first. */
function door2(words, label, press) {
  const line = document.createElement('p');
  line.textContent = words;
  const key = document.createElement('button');
  key.textContent = '[ ' + label + ' ]';
  key.addEventListener('click', press);
  at('door').append(line, key);
}

function door(words, label, press) {
  const line = document.createElement('p');
  line.textContent = words;
  const key = document.createElement('button');
  key.textContent = '[ ' + label + ' ]';
  key.addEventListener('click', press);
  at('door').replaceChildren(line, key);
}

frame.addEventListener('load', () => {
  const was = frameId;
  setTimeout(() => {
    // Loaded, and nothing in it has said where it is: it would not be shown, or it went to a site that was not added.
    if (!frame.hidden && frameId === was && was === null) say("THE SITE CAN'T BE SHOWN HERE: OPEN IT IN A TAB", true);
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
    }]] })), 'NO SITE ADDED.');
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
      key.title = group.sites.join(', ');
      key.addEventListener('click', async () => {
        if (await chrome.permissions.request({ origins: originsOfAll(missing) })) await chrome.runtime.sendMessage({ see: 'rules' });
        await open('sites');
      });
      offers.append(key);
    }
    const importing = document.createElement('button');
    importing.textContent = '[ IMPORT FROM THIS BROWSER ]';
    importing.title = 'The sites this browser has been to in the last 30 days, offered ticked; read here and given back at once';
    importing.addEventListener('click', () => void importSites(offers));
    offers.append(document.createElement('br'), importing);
    into.append(offers);
    return;
  }
  const where = await target();
  if (where === null) return list(into, [], 'NOTHING SHOWN.');
  if (which === 'media') list(into, ((await findMedia(where).catch(() => null)) ?? []).map(({ address: media, title }) => ({ words: title, small: media, keys: [['TO THE ROOM ↗', () => toRoom(media, title)]] })), 'NOTHING FOUND.');
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
