/*
 * The extension's worker. It lifts the no-framing header for the sites the reader has added, in the tabs the machine's own page is
 * open in and nowhere else; opens the machine when the site or the panel asks; and keeps the theme the site sends. It reads no page, cookie or password.
 */
import { allowedSites, isAllowed, NEVER_HOSTS, NEVER_NAMES, originsOf, readAddress, siteOf } from './sites.js';

const RULE = 1;

/** On added sites, the few lines that say which frame the machine's page is (frame.js), and no others. */
async function frameScript(sites) {
  await chrome.scripting.unregisterContentScripts().catch(() => undefined);
  if (sites.length > 0) await chrome.scripting.registerContentScripts([{ id: 'frame', matches: sites.flatMap(originsOf), js: ['frame.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: false }]);
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

/** One rule, for this session: frames in the machine's tabs, of added sites, never of a sign-in. */
async function frameRule() {
  const sites = await allowedSites();
  await frameScript(sites);
  const tabIds = [...new Set(machines.values())];
  const never = [...NEVER_NAMES, ...NEVER_HOSTS.filter((each) => !each.includes('/'))];
  // A sign-in kept under a site's own name (github.com/login): its headers are left alone, which is stronger than the rule below.
  const paths = NEVER_HOSTS.filter((each) => each.includes('/'));
  const old = (await chrome.declarativeNetRequest.getSessionRules()).map((rule) => rule.id);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: old,
    addRules: sites.length === 0 || machines.size === 0 ? [] : [
      ...paths.map((each, index) => ({ id: RULE + 1 + index, priority: 10, condition: { urlFilter: '||' + each + '^', tabIds, resourceTypes: ['sub_frame'] }, action: { type: 'allow' } })),
      ...paths.map((each, index) => ({ id: RULE + 1001 + index, priority: 10, condition: { urlFilter: '||' + each + '|', tabIds, resourceTypes: ['sub_frame'] }, action: { type: 'allow' } })),
      {
        id: RULE,
        priority: 1,
        condition: { tabIds, initiatorDomains: [chrome.runtime.id, ...sites], requestDomains: sites, excludedRequestDomains: [...new Set(never)], resourceTypes: ['sub_frame'] },
        action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }, { header: 'content-security-policy', operation: 'remove' }] },
      },
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

/** Colours and a face, as values: anything that isn't one is dropped, because the machine writes them into a stylesheet. */
export function themeFrom(value) {
  if (typeof value !== 'object' || value === null) return null;
  const colour = (each) => (typeof each === 'string' && /^#[0-9a-f]{6}$/i.test(each) ? each : null);
  const theme = { paper: colour(value.paper), ink: colour(value.ink), accent: colour(value.accent), quiet: colour(value.quiet), fault: colour(value.fault), faultInk: colour(value.faultInk), sun: colour(value.sun), scheme: value.scheme === 'light' ? 'light' : 'dark' };
  return Object.values(theme).every((each) => each !== null) ? theme : null;
}

/** The sites the site has asked about since the worker woke: it may ask about the pages it shows, and not go through a list. */
const asked = new Set();
const ASKED_MOST = 40;

// Only debaser.site can speak to it (`externally_connectable`), and only to say these things. It answers with its version and its two settings,
// never with a site the reader has added or a page they looked at.
chrome.runtime.onMessageExternal.addListener((message, sender, answer) => {
  if (sender.origin !== 'https://debaser.site') return;
  if (typeof message !== 'object' || message === null) return;
  if (message.see === 'ping') answer({ see: 'pong', version: chrome.runtime.getManifest().version });
  else if (message.see === 'theme') {
    const theme = themeFrom(message.theme);
    if (theme !== null) void chrome.storage.local.set({ theme });
    answer({ ok: theme !== null });
  } else if (message.see === 'open' && typeof message.address === 'string') {
    void openMachine(message.address);
    answer({ ok: true });
  } else if (message.see === 'has' && typeof message.address === 'string') {
    // About the one page it is asked of, and a few at most: the site is never told the list.
    const read = readAddress(message.address);
    if (read === null || asked.size >= ASKED_MOST) return answer({ on: null });
    const site = siteOf(new URL(read).hostname);
    asked.add(site);
    void isAllowed(read).then((on) => answer({ on, site }));
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
  else if (message.see === 'rules') void again().then(() => answer({ ok: true }));
  else return;
  return true;
});

void again();
