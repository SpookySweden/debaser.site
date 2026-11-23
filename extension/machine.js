/*
 * OWN EYE: the machine's own page. A site is shown in a frame here, fetched by this browser, where the reader is signed in: its cookies come
 * because this page is the extension's and has leave for that site. The frame can't move this page (no allow-top-navigation). Signing in is
 * always done in an ordinary tab: a sign-in page is never framed.
 */
import { findMedia, findWatchers, LENSES, list, putLens, settings, toRoom, toServerEye, wear } from './act.js';
import { allowedSites, isAllowed, neverFramed, originsOf, readAddress, siteOf } from './sites.js';

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
  if (neverFramed(read)) {
    frame.removeAttribute('src');
    door('SIGN-IN PAGES ARE NEVER SHOWN IN A FRAME.', 'OPEN IT IN A TAB', () => chrome.tabs.create({ url: read }));
    return say('SIGN-INS HAPPEN IN AN ORDINARY TAB', true);
  }
  if (!(await isAllowed(read))) {
    frame.removeAttribute('src');
    door(`THE MACHINE MAY ACT ON A SITE ONLY WHEN YOU ADD IT.`, `ADD ${site}`, async () => {
      // One site, and everything under its name. The browser asks too.
      if (await chrome.permissions.request({ origins: originsOf(site) })) {
        await chrome.runtime.sendMessage({ see: 'rules' });
        await show(read);
      }
    });
    return say(`NOT ADDED: ${site}`);
  }
  at('door').hidden = true;
  frame.hidden = false;
  frameId = null;
  frame.src = read;
  say('ACQUIRING SOURCE');
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
    return;
  }
  const where = await target();
  if (where === null) return list(into, [], 'NOTHING SHOWN.');
  if (which === 'media') list(into, ((await findMedia(where).catch(() => null)) ?? []).map(({ address: media, title }) => ({ words: title, small: media, keys: [['TO THE ROOM ↗', () => toRoom(media, title)]] })), 'NOTHING FOUND.');
  else list(into, ((await findWatchers(where).catch(() => null)) ?? []).map(({ host, count }) => ({ words: host, small: String(count) })), 'NOBODY.');
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
