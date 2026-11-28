/*
 * The extension's worker. It lifts the no-framing header for the sites the reader has added, in the tabs the machine's own page is
 * open in and nowhere else; opens the machine when the site or the panel asks; and keeps the theme the site sends. It reads no cookie and nothing typed
 * in a box. Of a page it reads only the one frame BROWSER made for OWN EYE: its drawn words while the reader's own OWN WEB switch is on
 * (off until two presses on the SITES page), and what a tool the reader pressed there asks for (0.8.2).
 */
import { findMedia, findWatchers, putLens } from './act.js';
import { allowedSites, EVERY_SITE, everySite, framedBy, isAllowed, isNamed, neverFramed, NEVER_HOSTS, NEVER_NAMES, originsOf, PROTECTS, readAddress, SITE, siteOf } from './sites.js';

const RULE = 1;

/** On added sites, the few lines that say which frame the machine's page is (frame.js), and no others. */
async function frameScript(sites, every) {
  await chrome.scripting.unregisterContentScripts().catch(() => undefined);
  // With EVERY SITE on it is on every page of the browser, and ends at its first line anywhere but directly inside a debaser.site page or the
  // machine's; inside a debaser.site page it speaks only once that page says its frame is the one BROWSER made for OWN EYE.
  const matches = every ? EVERY_SITE : sites.flatMap(originsOf);
  if (matches.length > 0) await chrome.scripting.registerContentScripts([{ id: 'frame', matches, js: ['frame.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: false }]);
}

/**
 * The tabs the machine's page is open in, each held by a line it keeps open: when the page goes, so does its tab's leave, whatever is opened there
 * next. (By tab, because a link followed inside the frame is asked for by the site, not by the machine.)
 */
const machines = new Map();
chrome.runtime.onConnect.addListener((port) => {
  const tab = port.sender?.tab?.id;
  if (port.name !== 'machine' || port.sender?.id !== chrome.runtime.id || port.sender?.url?.startsWith(chrome.runtime.getURL('machine.html')) !== true || tab === undefined) return port.disconnect();
  machines.set(port, tab);
  port.onDisconnect.addListener(() => {
    machines.delete(port);
    void again();
  });
  void again().then(() => port.postMessage({ see: 'ready' })).catch(() => undefined);
});

/**
 * BROWSER's page on debaser.site, while it is open in a tab (Luke, 2026-11-27: OWN EYE "inside a 'new tab' inside of debasers browser module"): an
 * added site may be shown in a frame there too, signed in where the site's own cookies are meant to work inside another site. The tab's leave goes
 * when the page does. Where a framed page got to is told back to that page, and to nobody else.
 */
const browsers = new Map();
const LENS_IDS = ['standard', 'reader', 'xray', 'lowfi', 'yours'];
/** The frame BROWSER's tab shows a page in, and the lens asked for there. */
const framedIn = new Map();
/** Where that frame last said it was. */
const framedHref = new Map();
/** Both, kept while the browser is open too: the worker sleeps and forgets, and a tool may be pressed long after the page said where it was. */
const framedKey = (tab) => 'framed:' + tab;
async function framedOf(tab) {
  const frameId = framedIn.get(tab);
  const href = framedHref.get(tab);
  if (frameId !== undefined && href !== undefined) return { frameId, href };
  const kept = (await chrome.storage.session.get(framedKey(tab)))[framedKey(tab)];
  return typeof kept?.frameId === 'number' && typeof kept.href === 'string' ? { frameId: kept.frameId, href: kept.href } : null;
}
const lensOf = new Map();
async function wearIn(tab) {
  const frameId = framedIn.get(tab);
  const lens = lensOf.get(tab);
  if (frameId === undefined || lens === undefined) return;
  await putLens({ tabId: tab, frameIds: [frameId] }, lens).catch(() => undefined);
}
chrome.runtime.onConnectExternal.addListener((port) => {
  const tab = port.sender?.tab?.id;
  // BROWSER's own page only, the tab's top frame: debaser.site framed inside another site's tab must not unlock frames in that tab.
  if (port.name !== 'browser' || port.sender?.origin !== SITE || tab === undefined || port.sender?.frameId !== 0) return port.disconnect();
  browsers.set(port, tab);
  // A lens BROWSER's page asks for, put on the page framed in its tab and worn again on each page it goes to: the reader stays signed in, since
  // the page is the site's own, in their own browser; the lens only changes how it looks.
  port.onMessage.addListener((message) => {
    if (message?.see !== 'lens' || !LENS_IDS.includes(message.lens)) return;
    lensOf.set(tab, message.lens);
    void wearIn(tab);
  });
  port.onDisconnect.addListener(() => {
    browsers.delete(port);
    if (![...browsers.values()].includes(tab)) {
      lensOf.delete(tab);
      framedIn.delete(tab);
      framedHref.delete(tab);
      void chrome.storage.session.remove(framedKey(tab));
    }
    void again();
  });
  void again().then(() => port.postMessage({ see: 'ready' })).catch(() => undefined);
});

/**
 * The rules, for this session: frames in the machine's tabs and BROWSER's, never of a sign-in. A page that refuses to be framed is told, in place
 * of that refusal, who may frame it here (`framedBy`), and nothing else of its headers is touched where that can be helped:
 *   - refused by X-Frame-Options alone: that line goes and ours is added beside the page's own policy, which stays whole;
 *   - a policy that is only about framing: replaced by ours;
 *   - a policy that mixes framing with script-safety rules: replaced by ours, so those rules are off for that page here, ONLY when its site was
 *     added by name (as it always was for added sites); under EVERY SITE alone it is left as it is, and the page does not show (decision 67).
 */
async function frameRule() {
  const [sites, every] = await Promise.all([allowedSites(), everySite()]);
  await frameScript(sites, every);
  const tabIds = [...new Set([...machines.values(), ...browsers.values()])];
  const never = [...new Set([...NEVER_NAMES, ...NEVER_HOSTS.filter((each) => !each.includes('/'))])];
  // A sign-in kept under a site's own name (github.com/login): its headers are left alone, which is stronger than the rules below.
  const paths = NEVER_HOSTS.filter((each) => each.includes('/'));
  const scope = { tabIds, resourceTypes: ['sub_frame'] };
  const refused = { header: 'x-frame-options' };
  const framing = { header: 'content-security-policy', values: ['*frame-ancestors*'] };
  const lift = (operation, policy) => ({ type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }, { header: 'content-security-policy', operation, value: policy }] });
  const named = framedBy(chrome.runtime.id, sites);
  const anyone = framedBy(chrome.runtime.id);
  const old = (await chrome.declarativeNetRequest.getSessionRules()).map((rule) => rule.id);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: old,
    addRules: (sites.length === 0 && !every) || tabIds.length === 0 ? [] : [
      ...paths.map((each, index) => ({ id: RULE + 1 + index, priority: 10, condition: { urlFilter: '||' + each + '^', ...scope }, action: { type: 'allow' } })),
      ...paths.map((each, index) => ({ id: RULE + 1001 + index, priority: 10, condition: { urlFilter: '||' + each + '|', ...scope }, action: { type: 'allow' } })),
      ...(sites.length === 0 ? [] : [
        { id: RULE, priority: 1, condition: { ...scope, requestDomains: sites, excludedRequestDomains: never, responseHeaders: [refused], excludedResponseHeaders: [framing] }, action: lift('append', named) },
        { id: RULE + 3001, priority: 1, condition: { ...scope, requestDomains: sites, excludedRequestDomains: never, responseHeaders: [framing] }, action: lift('set', named) },
      ]),
      ...(!every ? [] : [
        { id: RULE + 3002, priority: 1, condition: { ...scope, excludedRequestDomains: [...never, ...sites], responseHeaders: [refused], excludedResponseHeaders: [framing] }, action: lift('append', anyone) },
        { id: RULE + 3003, priority: 1, condition: { ...scope, excludedRequestDomains: [...never, ...sites], responseHeaders: [framing], excludedResponseHeaders: [{ header: 'content-security-policy', values: PROTECTS }] }, action: lift('set', anyone) },
      ]),
    ],
  });
}
// One at a time: two at once would each undo the other's half.
let last = Promise.resolve();
const again = () => (last = last.then(frameRule).catch((error) => console.warn('the machine could not set its rules:', error.message)));
chrome.runtime.onInstalled.addListener(() => void again());
chrome.runtime.onStartup.addListener(() => void again());
chrome.permissions.onAdded.addListener(() => void again());
chrome.permissions.onRemoved.addListener(() => void again());

// The key in the browser's own bar opens the panel beside the tab.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

/** The lenses there are, and whether it wears the site's theme: nothing else is a setting. */
export function settingsFrom(value) {
  if (typeof value !== 'object' || value === null) return null;
  const lens = ['standard', 'reader', 'xray', 'lowfi', 'yours'].find((each) => each === value.lens);
  return lens === undefined || typeof value.wear !== 'boolean' ? null : { lens, wear: value.wear };
}

/** Whether one version comes after another: numbers between dots, and nothing else is a version. */
export function newer(one, other) {
  if (![one, other].every((each) => typeof each === 'string' && /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(each))) return false;
  const [a, b] = [one.split('.').map(Number), other.split('.').map(Number)];
  for (let i = 0; i < 4; i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

export async function openMachine(address) {
  const read = address === undefined ? null : readAddress(address);
  await chrome.tabs.create({ url: chrome.runtime.getURL('machine.html') + (read === null ? '' : '#see=' + encodeURIComponent(read)) });
}

/**
 * OWN EYE as the browser itself (Luke, 2026-11-27: "use it like they would chrome or edge"): the page in an ordinary tab, where tabs, back and
 * forward, sign-ins, video and downloads are the browser's own because they are, and the machine's lenses beside it in the side panel. The panel
 * opens by itself where the browser lets it; its key in the bar always does.
 */
export async function openTab(address) {
  const read = readAddress(address);
  if (read === null) return;
  const tab = await chrome.tabs.create({ url: read });
  await chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
}

/** Colours and a face, as values: anything that isn't one is dropped, because the machine writes them into a stylesheet. */
export function themeFrom(value) {
  if (typeof value !== 'object' || value === null) return null;
  const colour = (each) => (typeof each === 'string' && /^#[0-9a-f]{6}$/i.test(each) ? each : null);
  const theme = { paper: colour(value.paper), ink: colour(value.ink), accent: colour(value.accent), quiet: colour(value.quiet), fault: colour(value.fault), faultInk: colour(value.faultInk), sun: colour(value.sun), scheme: value.scheme === 'light' ? 'light' : 'dark' };
  return Object.values(theme).every((each) => each !== null) ? theme : null;
}

/**
 * The sites the site has asked about this hour, kept while the browser is open (the worker sleeps): it may ask about the pages it shows, and not go
 * through a list.
 */
const ASKED_MOST = 40;
const HOUR_MS = 3_600_000;
// One at a time: two asks at once would both read the old list, and the second write would lose the first site.
let asking = Promise.resolve();
function mayAsk(site) {
  const turn = asking.then(() => mayAskNow(site));
  asking = turn.catch(() => undefined);
  return turn;
}
async function mayAskNow(site) {
  const kept = (await chrome.storage.session.get('asked')).asked;
  const now = Date.now();
  const asked = kept && now - kept.since < HOUR_MS ? kept : { since: now, sites: [] };
  if (!asked.sites.includes(site)) {
    if (asked.sites.length >= ASKED_MOST) return false;
    asked.sites.push(site);
  }
  await chrome.storage.session.set({ asked });
  return true;
}

/**
 * OWN WEB for the pages OWN EYE shows (Luke, 2026-11-27: "Keep every page"). The switch is kept HERE, in this browser, off until two presses on
 * this extension's own SITES page turn it on: debaser.site can read it and switch it OFF, never on. While it is off no page's words are read
 * or handed out, whatever debaser.site's page asks.
 */
const keeping = async () => (await chrome.storage.local.get('keep')).keep === true;
const WORDS_MOST = 200_000;

/**
 * Run inside the one framed page: its words as a reader sees them, and nothing else. Never what is in a box (inputs of every kind, passwords,
 * hidden and one-time-code fields, text areas, editable parts), never anything not drawn (hidden, moved off the page, one pixel big), never a
 * frame inside it, a cookie, storage or the page's code. Null from any frame that isn't directly inside a page of `site`.
 */
function visibleWords(site, most) {
  if (window === window.top || window.parent !== window.top || location.ancestorOrigins[0] !== site) return null;
  // `input` is every kind of input there is: typed, secret, hidden.
  const NEVER = 'script,style,noscript,template,head,input,[autocomplete~="one-time-code"],textarea,select,option,datalist,output,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[hidden],[aria-hidden="true"],iframe,frame,object,embed,svg,canvas,video,audio';
  const BLOCK = 'p,div,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,pre,section,article,dd,dt,figcaption,main,header,footer,aside,nav,form,tr,body';
  const drawn = new Map();
  const isDrawn = (element) => {
    let known = drawn.get(element);
    if (known === undefined) {
      known = false;
      if (element.closest(NEVER) === null && typeof element.checkVisibility === 'function' && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) {
        const box = element.getBoundingClientRect();
        known = box.width >= 2 && box.height >= 2 && box.right + window.scrollX > 0 && box.bottom + window.scrollY > 0;
      }
      drawn.set(element, known);
    }
    return known;
  };
  const paragraphs = [];
  let size = 0;
  let block = null;
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null && size < most; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || !isDrawn(parent)) continue;
    const words = node.nodeValue.replace(/\s+/g, ' ');
    if (words.trim() === '') continue;
    const within = parent.closest(BLOCK);
    if (within === block && paragraphs.length > 0) paragraphs[paragraphs.length - 1].words += words;
    else paragraphs.push({ heading: within !== null && /^H[1-6]$/.test(within.tagName), words });
    block = within;
    size += words.length;
  }
  return {
    href: location.href,
    title: document.title.slice(0, 200),
    description: (document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '').slice(0, 300),
    language: (document.documentElement.getAttribute('lang') ?? '').slice(0, 20),
    paragraphs: paragraphs.map((each) => ({ heading: each.heading, words: each.words.trim().slice(0, most) })).filter((each) => each.words !== ''),
  };
}

/** The words of the page framed in BROWSER's tab, for BROWSER's own page in that tab and nobody else; `why` when there are none to give. */
async function wordsFor(sender, address) {
  const tab = sender.tab?.id;
  // BROWSER's own page: the top of a tab it holds open to this extension. Never an ordinary tab, never debaser.site framed somewhere.
  if (tab === undefined || sender.frameId !== 0 || ![...browsers.values()].includes(tab)) return { why: 'not-browser' };
  if (!(await keeping())) return { why: 'off' };
  // The one frame that said, after BROWSER's page said so itself, that it is the frame BROWSER made for OWN EYE (frame.js).
  const framed = await framedOf(tab);
  if (framed === null) return { why: 'no-page' };
  const [made] = await chrome.scripting.executeScript({ target: { tabId: tab, frameIds: [framed.frameId] }, func: visibleWords, args: [SITE, WORDS_MOST] }).catch(() => []);
  const read = made?.result;
  if (typeof read !== 'object' || read === null || typeof read.href !== 'string' || !/^https?:\/\//.test(read.href)) return { why: 'no-page' };
  // Only the page BROWSER already knows it is showing, and never one on the never-list (sign-ins, banks, payments).
  if (read.href.split('#')[0] !== address.split('#')[0]) return { why: 'moved' };
  if (neverFramed(read.href)) return { why: 'never' };
  return { words: read };
}

/**
 * Four of BROWSER's tools on a page OWN EYE shows (Luke, 2026-11-28: "MEDIA,SEARCH THIS,WATCHERS,ERASE"), done here because the page is the
 * site's own, in the reader's browser: the house has no copy of it. Each acts on the one frame BROWSER made for OWN EYE in the tab that asks,
 * and answers BROWSER's own page there and nobody else. MEDIA: the videos and sounds the page names. WATCHERS: the outside hosts it spoke to.
 * SEARCH THIS: the words selected on it, never ones inside a box. ERASE: the part pressed is hidden, in that page only.
 */
const TOOLS = ['media', 'watchers', 'selection', 'erase'];
const SELECTOR = /^(?:#[A-Za-z][\w-]{0,60}|[a-z][a-z0-9-]{0,40}:nth-of-type\(\d{1,5}\))(?: > [a-z][a-z0-9-]{0,40}:nth-of-type\(\d{1,5}\)){0,8}$/;
const isSelector = (text) => typeof text === 'string' && text.length <= 500 && SELECTOR.test(text);
const ERASED_MOST = 100;
const POINTED = '[data-debaser-see-pointed]{outline:2px dashed currentColor!important;outline-offset:-2px!important;cursor:crosshair!important}';

/** Run inside the framed page: the words selected on it, as one line. Never words inside a field or an editable part. */
function selectionIn() {
  const picked = window.getSelection();
  if (picked === null || picked.rangeCount === 0 || picked.isCollapsed) return '';
  const BOX = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"]';
  const within = (node) => (node instanceof Element ? node : (node?.parentElement ?? null))?.closest(BOX) ?? null;
  const active = document.activeElement;
  if ((active !== null && active.matches(BOX)) || within(picked.anchorNode) !== null || within(picked.focusNode) !== null) return '';
  return String(picked).replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Run inside the framed page: ERASE's pointer. While on, the part under the pointer is outlined, and a press on it is told (never followed). */
function erasePicker(on) {
  const held = (globalThis.debaserErase ??= { on: false, pointed: null, bound: false });
  held.on = on;
  if (!on && held.pointed !== null) {
    held.pointed.removeAttribute('data-debaser-see-pointed');
    held.pointed = null;
  }
  if (held.bound) return true;
  held.bound = true;
  // A part as BROWSER names it: by its id, or by which of its kind it is under its parents, a few steps up.
  const selectorOf = (element) => {
    const parts = [];
    for (let at = element; at && at !== document.documentElement && parts.length < 8; at = at.parentElement) {
      if (at.id && /^[A-Za-z][\w-]{0,60}$/.test(at.id)) {
        parts.unshift('#' + at.id);
        break;
      }
      let index = 1;
      for (let before = at.previousElementSibling; before; before = before.previousElementSibling) if (before.localName === at.localName) index += 1;
      if (!/^[a-z][a-z0-9-]{0,40}$/.test(at.localName)) return null;
      parts.unshift(at.localName + ':nth-of-type(' + index + ')');
    }
    return parts.length === 0 || (parts.length === 1 && /^(?:body|html)/.test(parts[0])) ? null : parts.join(' > ');
  };
  document.addEventListener(
    'mousemove',
    (event) => {
      if (!held.on || !event.isTrusted || !(event.target instanceof Element) || event.target === held.pointed) return;
      held.pointed?.removeAttribute('data-debaser-see-pointed');
      held.pointed = event.target;
      held.pointed.setAttribute('data-debaser-see-pointed', '');
    },
    true,
  );
  window.addEventListener(
    'click',
    (event) => {
      if (!held.on || !event.isTrusted || !(event.target instanceof Element)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const selector = selectorOf(event.target);
      try {
        if (selector !== null) chrome.runtime.sendMessage({ see: 'erased', selector }).catch(() => undefined);
      } catch {
        // This copy of the extension has gone (updated or reloaded): the page says nothing.
      }
    },
    true,
  );
  return true;
}

/** What ERASE has taken out of this page, as a stylesheet of the reader's own; the one before it is taken off first. */
async function eraseIn(target, on, selectors) {
  const key = 'erased:' + target.tabId;
  const before = (await chrome.storage.session.get(key))[key];
  if (typeof before === 'string') await chrome.scripting.removeCSS({ target, css: before, origin: 'USER' }).catch(() => undefined);
  const css = (selectors.length > 0 ? selectors.join(',') + '{display:none!important}' : '') + POINTED;
  await chrome.scripting.insertCSS({ target, css, origin: 'USER' });
  await chrome.storage.session.set({ [key]: css });
  const [made] = await chrome.scripting.executeScript({ target, func: erasePicker, args: [on] });
  return made?.result === true;
}

async function toolFor(sender, message) {
  const tab = sender.tab?.id;
  // As for a page's words: BROWSER's own page, the top of a tab it holds, and the one frame it made for OWN EYE there.
  if (tab === undefined || sender.frameId !== 0 || ![...browsers.values()].includes(tab)) return null;
  const framed = await framedOf(tab);
  if (framed === null) return null;
  const target = { tabId: tab, frameIds: [framed.frameId] };
  // Where that frame is NOW, asked of the frame itself (it may have moved since it last spoke): never a page on the never-list.
  const [at] = await chrome.scripting.executeScript({ target, func: () => (window !== window.top && window.parent === window.top ? location.href : null) });
  if (typeof at?.result !== 'string' || neverFramed(at.result)) return null;
  if (message.tool === 'media') return (await findMedia(target)) ?? [];
  if (message.tool === 'watchers') return (await findWatchers(target)) ?? [];
  if (message.tool === 'erase') return eraseIn(target, message.on === true, Array.isArray(message.erased) ? message.erased.filter(isSelector).slice(0, ERASED_MOST) : []);
  const [made] = await chrome.scripting.executeScript({ target, func: selectionIn });
  return typeof made?.result === 'string' ? made.result : null;
}

// Only debaser.site can speak to it (`externally_connectable`), and only to say these things. It answers with its version and its two settings,
// never with a site the reader has added; a page's address goes only to BROWSER's own page in the tab showing it, and a page's words only
// there too, and only while the reader has switched OWN WEB on here.
chrome.runtime.onMessageExternal.addListener((message, sender, answer) => {
  if (sender.origin !== 'https://debaser.site') return;
  if (typeof message !== 'object' || message === null) return;
  if (message.see === 'ping') answer({ see: 'pong', version: chrome.runtime.getManifest().version });
  else if (message.see === 'theme') {
    const theme = themeFrom(message.theme);
    if (theme !== null) void chrome.storage.local.set({ theme });
    answer({ ok: theme !== null });
  } else if (message.see === 'open' && typeof message.address === 'string') {
    // An ordinary tab unless the machine's own page is asked for (its frame, for the lenses that need it).
    void (message.in === 'machine' ? openMachine(message.address) : openTab(message.address));
    answer({ ok: true });
  } else if (message.see === 'has' && typeof message.address === 'string') {
    // About the one page it is asked of, and a few at most: the site is never told the list.
    const read = readAddress(message.address);
    if (read === null) return answer({ on: null });
    const site = siteOf(new URL(read).hostname);
    // `on`: this page may be shown (its site was added by name, or EVERY SITE is on, which says nothing of the list). `named`: this one site is
    // on the list itself; past the few it may ask about, that half is not said, only that every site is allowed.
    void Promise.all([mayAsk(site), everySite()]).then(async ([may, every]) => answer(may ? { on: await isAllowed(read), site, named: await isNamed(read) } : every ? { on: true, site, named: null, every: true } : { on: null }));
    return true;
  } else if (message.see === 'settings') {
    const given = settingsFrom(message.settings);
    void (given === null ? Promise.resolve() : chrome.storage.local.set({ settings: given }))
      .then(() => chrome.storage.local.get('settings'))
      .then((kept) => answer({ see: 'settings', settings: settingsFrom(kept.settings) ?? { lens: 'standard', wear: true } }));
    return true;
  } else if (message.see === 'sites') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('machine.html') + '#sites' });
    answer({ ok: true });
  } else if (message.see === 'keep') {
    // OWN WEB's switch for OWN EYE's pages: read, or switched OFF. Never on from here: that is two presses on the SITES page.
    void (message.off === true ? chrome.storage.local.set({ keep: false }) : Promise.resolve()).then(keeping).then((on) => answer({ see: 'keep', on }));
    return true;
  } else if (message.see === 'words' && typeof message.address === 'string') {
    void wordsFor(sender, message.address)
      .catch(() => ({ why: 'no-page' }))
      .then((found) => answer({ see: 'words', ...found }));
    return true;
  } else if (message.see === 'tool' && TOOLS.includes(message.tool)) {
    void toolFor(sender, message)
      .catch(() => null)
      .then((found) => answer({ see: 'tool', tool: message.tool, found }));
    return true;
  } else if (message.see === 'newest' && typeof message.version === 'string') {
    const waiting = newer(message.version, chrome.runtime.getManifest().version);
    void chrome.action.setBadgeText({ text: waiting ? 'NEW' : '' });
    void chrome.action.setTitle({ title: waiting ? 'DEBASER SEEING MACHINE: AN UPDATE IS READY ON DEBASER.SITE' : 'DEBASER SEEING MACHINE' });
    answer({ ok: true });
  } else if (message.see === 'reload') {
    // Its own files were written again by the site, in the folder the reader picked: read from there, as the ↻ key in the browser's list does.
    answer({ ok: true });
    setTimeout(() => chrome.runtime.reload(), 150);
  }
});

chrome.runtime.onMessage.addListener((message, sender, answer) => {
  if (sender.id !== chrome.runtime.id || typeof message !== 'object' || message === null) return;
  if (message.see === 'machine') void openMachine(message.address).then(() => answer({ ok: true }));
  else if (message.see === 'frame' && sender.tab?.id !== undefined && sender.frameId !== 0 && typeof message.href === 'string') {
    // A page in one of BROWSER's tabs: where it got to, to that tab's BROWSER page alone.
    const ours = [...browsers].filter(([, tab]) => tab === sender.tab.id);
    for (const [port] of ours) port.postMessage({ see: 'at', href: message.href, title: typeof message.title === 'string' ? message.title.slice(0, 160) : '' });
    if (ours.length > 0) {
      framedIn.set(sender.tab.id, sender.frameId);
      framedHref.set(sender.tab.id, message.href);
      void chrome.storage.session.set({ [framedKey(sender.tab.id)]: { frameId: sender.frameId, href: message.href } });
      void wearIn(sender.tab.id);
    }
    return;
  } else if (message.see === 'erased' && sender.tab?.id !== undefined && isSelector(message.selector)) {
    // ERASE's press, from the one frame BROWSER made in that tab: which part, to that tab's BROWSER page alone, which keeps the list.
    void framedOf(sender.tab.id).then((framed) => {
      if (framed === null || framed.frameId !== sender.frameId) return;
      for (const [port, tab] of browsers) if (tab === sender.tab.id) port.postMessage({ see: 'erased', selector: message.selector, href: framed.href });
    });
    return;
  } else if (message.see === 'tab' && typeof message.address === 'string') void openTab(message.address).then(() => answer({ ok: true }));
  else if (message.see === 'rules') void again().then(() => answer({ ok: true }));
  else return;
  return true;
});

void again();
