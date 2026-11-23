/*
 * On added sites only, and silent unless the page is in the machine's own frame: says which frame it is, and where it is, so a lens can be put on
 * it. A page in an ordinary tab, or in anybody else's frame, is left alone.
 */
if (window !== window.top && window.parent === window.top && location.ancestorOrigins[0] === 'chrome-extension://' + chrome.runtime.id) {
  chrome.runtime.sendMessage({ see: 'frame', href: location.href, title: document.title.slice(0, 160) }).catch(() => undefined);
}
