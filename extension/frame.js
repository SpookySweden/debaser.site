/*
 * On added sites only (on every site once ALLOW EVERY SITE is pressed), and silent unless the page is directly in the machine's own frame or in
 * the one frame BROWSER on debaser.site made for OWN EYE: says which frame it is, and where it is, so a lens can be put on it and BROWSER can say
 * where it got to (the worker drops it unless BROWSER's page holds that tab). A page in an ordinary tab, or in anybody else's frame, is left
 * alone: the one test below is all that runs there, and it reads nothing of the page and sends nothing. Directly inside a debaser.site page it
 * asks that page one fixed question, whether this is the frame it made for OWN EYE, and BROWSER says yes to that frame alone: any other frame on
 * the site (the floating player, a video in a post) hears nothing back and stays silent. An address that changes inside one page, with no new
 * page loaded (a video clicked on YouTube), is said too: looked for twice a second.
 */
if (window !== window.top && window.parent === window.top && (location.ancestorOrigins[0] === 'chrome-extension://' + chrome.runtime.id || location.ancestorOrigins[0] === 'https://debaser.site')) {
  let told = '';
  let looking = 0;
  const tell = () => {
    if (location.href === told) return;
    told = location.href;
    try {
      chrome.runtime.sendMessage({ see: 'frame', href: told, title: document.title.slice(0, 160) }).catch(() => undefined);
    } catch {
      // The extension was reloaded under this page: nobody is left to tell.
      clearInterval(looking);
    }
  };
  const begin = () => {
    if (looking !== 0) return;
    looking = setInterval(tell, 500);
    tell();
  };
  if (location.ancestorOrigins[0] !== 'https://debaser.site') begin();
  else {
    addEventListener('message', (event) => {
      if (event.source === window.parent && event.origin === 'https://debaser.site' && event.data?.see === 'own-eye') begin();
    });
    window.parent.postMessage({ see: 'own-eye?' }, 'https://debaser.site');
  }
}
