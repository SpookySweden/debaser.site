/*
 * The panel beside an ordinary tab: the same lenses, put on the tab in front when the reader presses one. A press on the extension's key gives it
 * that tab and no other (activeTab); a tab it has no leave for says so.
 */
import { findMedia, findWatchers, LENSES, list, putLens, toRoom, toServerEye, wear } from './act.js';
import { groupOf, isAllowed, neverFramed, originsOfAll, siteOf } from './sites.js';

const at = (id) => document.getElementById(id);
const tabNow = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const isPage = (tab) => tab !== undefined && /^https?:/.test(tab.url ?? '');

async function look() {
  const tab = await tabNow();
  if (!isPage(tab)) {
    at('add').hidden = true;
    at('where').textContent = 'PRESS THE MACHINE\'S KEY ON THE PAGE YOU WANT TO SEE.';
    list(at('media'), [], '');
    list(at('watchers'), [], '');
    return;
  }
  at('where').textContent = new URL(tab.url).hostname;
  // ADD THIS SITE: the site in front, on the list or not, in words. A press here is the press the browser needs; it asks too.
  const site = siteOf(new URL(tab.url).hostname);
  const on = neverFramed(tab.url) ? null : await isAllowed(tab.url);
  const add = at('add');
  add.hidden = on === null;
  add.disabled = on === true;
  // A site that shares its sign-in brings the rest of them, named on the key before it is pressed.
  const group = groupOf(site);
  add.textContent = on ? '[ ✓ ON THE LIST: ' + site + ' ]' : group === null ? '[ ADD ' + site + ' ]' : '[ ADD ' + group.name + ': ' + site + ' AND ' + (group.sites.length - 1) + ' MORE ]';
  add.title = group === null ? site : group.sites.join(', ');
  add.onclick = async () => {
    if (await chrome.permissions.request({ origins: originsOfAll(group === null ? [site] : group.sites) })) await chrome.runtime.sendMessage({ see: 'rules' });
    await look();
  };
  const where = { tabId: tab.id };
  list(at('media'), ((await findMedia(where).catch(() => null)) ?? []).map(({ address, title }) => ({ words: title, small: address, keys: [['TO THE ROOM ↗', () => toRoom(address, title)]] })), 'NOTHING FOUND.');
  list(at('watchers'), ((await findWatchers(where).catch(() => null)) ?? []).map(({ host, count }) => ({ words: host, small: String(count) })), 'NOBODY.');
}

for (const [id, label] of LENSES) {
  const key = document.createElement('button');
  key.textContent = '[ ' + label + ' ]';
  key.setAttribute('aria-pressed', 'false');
  key.addEventListener('click', async () => {
    const tab = await tabNow();
    if (!isPage(tab)) return;
    const said = await putLens({ tabId: tab.id }, id).catch(() => 'PRESS THE MACHINE\'S KEY ON THIS TAB FIRST.');
    at('status').textContent = said ?? '';
    at('status').className = said === null ? '' : 'fault';
    for (const each of at('lenses').children) each.setAttribute('aria-pressed', String(each === key && said === null));
  });
  at('lenses').append(key);
}
at('machine').addEventListener('click', async () => {
  const tab = await tabNow();
  await chrome.runtime.sendMessage({ see: 'machine', address: isPage(tab) && !neverFramed(tab.url) ? tab.url : undefined });
});
at('server').addEventListener('click', async () => {
  const tab = await tabNow();
  if (isPage(tab)) await toServerEye(tab.url);
});
chrome.tabs.onActivated.addListener(() => void look());
chrome.tabs.onUpdated.addListener((id, change) => change.status === 'complete' && void look());
await wear();
await look();
